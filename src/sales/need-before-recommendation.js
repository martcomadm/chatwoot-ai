import { plausibleName } from "../semantic/name-validator.js";
function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

const MEDICAL = /\b(servicio medico|seguro medico|atencion medica|consultas|medicinas|hospital|maternidad|guarderia|beneficiarios?)\b|^(?:solo\s+)?(?:el\s+)?(?:servicio|seguro)(?:\s+(?:solo|nada mas|nomas))?$/;
const WEEKS = /\b(semanas|cotizar|cotizando|seguir cotizando|recuperar semanas|continuar semanas)\b/;
const AFORE_INFONAVIT = /\b(afore|infonavit|credito de vivienda|credito infonavit|puntos infonavit|vivienda)\b/;
const RETIREMENT = /\b(pension\w*|pensionar\w*|retiro|jubilar\w*|jubilacion)\b/;

export function deriveCommercialNeed(text, previous = {}) {
  const value = norm(text);
  const next = {
    service_medical: Boolean(previous.service_medical),
    weeks: Boolean(previous.weeks),
    afore_infonavit: Boolean(previous.afore_infonavit),
    retirement: Boolean(previous.retirement),
    unknown: previous.unknown !== false,
  };

  // "Solo quiero pensionarme, tengo servicio médico", "Servicio médico no ocupo" (casos reales 23 y 24-oct): lo que ya tiene.
  const hasMedical = /\b(?:ya\s+)?(?:tengo|cuento con)\s+(?:el\s+|mi\s+)?(?:servicio medico|seguro medico|servicing medico)\b|\b(?:servicio medico|seguro medico)\s+(?:no|ya no)\s+(?:ocupo|necesito|requiero)\b|\bno\s+(?:ocupo|necesito|requiero)\s+(?:el\s+)?(?:servicio medico|seguro medico)\b/.test(value);
  if (MEDICAL.test(value.replace(/\b(?:ya\s+)?(?:tengo|cuento con)\s+(?:el\s+|mi\s+)?(?:servicio medico|seguro medico)\b|\b(?:servicio medico|seguro medico)\s+(?:no|ya no)\s+(?:ocupo|necesito|requiero)\b|\bno\s+(?:ocupo|necesito|requiero)\s+(?:el\s+)?(?:servicio medico|seguro medico)\b/g, " "))) next.service_medical = true;
  else if (hasMedical && !previous.service_medical) next.service_medical = false;
  if (WEEKS.test(value)) next.weeks = true;
  // "No Infonavit, no Afore, semanas ok" descarta el Plan 2 aunque mencione esas palabras.
  const rejectsAforeInfonavit = /\b(?:no|sin|ni|menos|excepto|salvo)\s+(?:me interesa\s+|quiero\s+|necesito\s+)?(?:el\s+|la\s+)?(?:afore|infonavit)\b|\b(?:afore|infonavit)\b.{0,20}\b(?:no me interesa|no quiero|no necesito|ya no (?:alcanzo|me alcanza|aplica|me sirve))\b|\brenunci\w*\s+(?:a\s+|al\s+)?(?:mi\s+|la\s+)?afore\b/.test(value);
  // "Ya tengo mi afore y mi seguro" dice lo que tiene, no lo que busca (caso real 20-oct).
  // "Ya no tengo, me dieron el dinero y el aforé" (caso real 21-oct): ya retiró su AFORE.
  const mentionsOwn = /\b(?:ya\s+)?(?:tengo|cuento con)\s+(?:mi\s+|una\s+|mis\s+)?(?:afore|infonavit|credito)\b/.test(value)
    || /\b(?:me dieron|me entregaron|retire|saque|cobre|ya cobre)\b.{0,30}\b(?:afore|dinero)\b/.test(value);
  if (rejectsAforeInfonavit) next.afore_infonavit = false;
  else if (AFORE_INFONAVIT.test(value.replace(/\b(?:ya\s+)?(?:tengo|cuento con)\s+(?:mi\s+|una\s+|mis\s+)?(?:afore|infonavit|credito)\b/g, " ")) && !(mentionsOwn && !/\b(?:aportar|aportaciones|sumar|puntos|quiero|me interesa)\b/.test(value))) next.afore_infonavit = true;
  // "¿Cómo puedo hacer esas aportaciones?" = AFORE (caso Laura, 17-oct); "sin aportaciones" no.
  // "Aportar si es posible" a "¿…o también aportar a AFORE e INFONAVIT?" (caso real 21-oct).
  else if (/\b(?:aportaciones?|aportar|aporte)\b/.test(value) && !/\b(?:sin|ninguna|no tengo|no hay|no quiero|no puedo)\s+(?:\w+\s+)?(?:aportaciones?|aportar)\b/.test(value)) next.afore_infonavit = true;
  if (RETIREMENT.test(value)) next.retirement = true;
  next.unknown = !(next.service_medical || next.weeks || next.afore_infonavit || next.retirement);
  return next;
}

export function hasCommercialNeed(memory = {}) {
  // Si el cliente ya eligió un plan ("Me interesa el plan 1"), no se le vuelve a preguntar qué busca.
  if (memory.sales_cycle?.selected_plan) return true;
  const need = memory.commercial_need || {};
  // Only deterministic, structured signals count as commercial need. The LLM field
  // necesidad_principal may contain contextual prose (for example "desempleado") and
  // must never bypass the Need Before Recommendation guard by itself.
  return Boolean(need.service_medical || need.weeks || need.afore_infonavit || need.retirement);
}

export function isAdvisoryTurn(text = "") {
  const value = norm(text);
  return /\b(?:no se que me conviene|que me conviene|quiero que me guien|guiame|orientame|asesorame|quiero asesoria|necesito asesoria|busco asesoria|quiero orientacion|necesito orientacion|que opcion me conviene|que opcion seria mejor para mi)\b/.test(value);
}

export function needGuardDecision(memory = {}, combinedText = "") {
  if (memory?.sales_cycle?.authorized || hasCommercialNeed(memory)) return null;
  // An advisory turn must reach the conversational model. The guard still
  // prevents an unsupported recommendation afterwards, but it must not replace
  // the customer's request for guidance with the same discovery question.
  if (isAdvisoryTurn(combinedText)) return null;
  if (!memory?.nombre || !memory?.edad || !memory?.actividad) return null;
  // Si el cliente pregunta algo, se le responde primero (la IA contesta); no se repite la
  // pregunta de necesidad encima de su pregunta (caso real: se repitió 3 veces).
  if (/[?¿]/.test(String(combinedText)) || /^(?:que|cual|cuales|como|cuanto|cuando|donde|por que|tu dime|dime|me puedes|explicame)\b/.test(norm(combinedText))) return null;
  if (/para orientarte mejor, ¿que es lo mas importante para ti/.test(norm(memory?.ultima_respuesta_agente || ""))) return null;

  const candidateName = memory?.primer_nombre || String(memory?.nombre || "").trim().split(/\s+/)[0] || null;
  const firstName = candidateName && plausibleName(candidateName) ? candidateName : null;
  return {
    reply: `${firstName ? `${firstName}, para` : "Para"} orientarte mejor, ¿qué es lo más importante para ti con la afiliación: tener servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?`,
    question_key: "necesidad_principal",
    add_labels: [],
    remove_labels: [],
    handoff: false,
    handoff_reason: "",
  };
}

export function suppressRecommendationWithoutNeed(decision, memory = {}, combinedText = "") {
  if (hasCommercialNeed(memory) || memory?.sales_cycle?.authorized) return decision;
  const text = String(decision?.reply || "");
  const recommendsPlan = /\b(te recomiendo|recomiendo|mejor opcion|mejor opción|plan\s*[12])\b/i.test(text);
  if (!recommendsPlan) return decision;
  // El cliente preguntó por un plan, los precios o qué ofrecen ("El plan 1 q implica?", "Hello! Can I get more
  // info?", "¿cómo se afilia uno trabajando por su cuenta?"; casos reales 23 al 25-oct): presentar los dos
  // planes (o el que preguntó) no es recomendar sin necesidad.
  const customer = norm(combinedText);
  const asksPlan = /\bplan\s*(?:1|2|uno|dos)\b/.test(customer);
  const asksInfo = /\b(?:informacion|info|more info|precio|precios|costo|costos|cuanto|planes|que ofrecen|que servicios|que manejan|como funciona|que implica|como se afilia|como me afilio|como me aseguro|como se asegura|diferencia)\b/.test(customer);
  const bothPlans = /\bplan\s*1\b/i.test(text) && /\bplan\s*2\b/i.test(text) && !/\b(?:te recomiendo|recomiendo|mejor opcion|mejor opción|te conviene)\b/i.test(text);
  if (asksPlan && !/\b(?:te recomiendo|recomiendo|te conviene)\b/i.test(text)) return decision;
  if (asksInfo && bothPlans) return decision;
  return needGuardDecision(memory, combinedText) || { ...decision, reply: "Con gusto te ayudo. Para recomendarte la mejor opción, ¿qué buscas principalmente: servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?", question_key: "necesidad_principal" };
}
