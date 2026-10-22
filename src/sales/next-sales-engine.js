import { negatesCommitment } from "./commitment-negation.js";
import { confirmsStart, genericInterest } from "./start-confirmation.js";
import { detectDeferral } from "./customer-deferral.js";

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

const AUTHORIZATION_PATTERNS = [
  // El verbo solo cuenta si cierra la frase ("quiero iniciar.") o va seguido del trámite/plan
  // ("quiero iniciar el trámite"). "Quiero empezar a entender bien" NO es autorización.
  /\b(?:quiero|deseo|podemos|quiero que)\s+(?:contratar|contratarlo|iniciar|hacerlo|proceder|continuar|empezar)(?=\s*(?:$|[.,;!?])|\s+(?:ya|ahora|hoy|por favor)\b|\s+(?:con\s+)?(?:el\s+|mi\s+)?(?:tramite|proceso|alta|plan|contratacion|afiliacion)\b)/,
  /\badelante con (el )?(tramite|proceso|alta)\b/,
  // "Pues iniciar trámite" (caso real 21-oct).
  /^(?:(?:pues|si|ok|bueno|entonces|claro|va|vamos a|ya)[ ,]*)*(?:iniciar|empezar|comenzar|arrancar)(?:le)?\s+(?:con\s+)?(?:el\s+|mi\s+)?(?:tramite|proceso|alta)\b/,
  /\b(iniciemos|empecemos|empezemos|procedamos)(?:\s+(?:con )?(?:el )?(?:tramite|proceso|alta))?\b/,
  /\bme interesa (contratarlo|hacerlo|iniciar|proceder)\b/,
  /\bsi[, ]+(quiero (?:iniciar|proceder|continuar|empezar)|adelante con (?:el )?(?:tramite|proceso|alta)|procedamos|iniciemos|empecemos|empezemos)\b/,
  /\b(?:si[, ]*)?me interesa[, ]+(?:empecemos|empezemos|iniciemos|procedamos)(?:\s+(?:con )?(?:el )?(?:tramite|proceso|alta))?\b/,
];

const ALTA_INTEREST_PATTERNS = [
  /\bquiero darme de alta\b/,
  /\bquiero dar de alta\b/,
  /\bquiero afiliarme\b/,
  /\bquiero la afiliacion\b/,
  /\bme quiero dar de alta\b/,
];

const PLAN_SELECTION_PATTERNS = [
  // "Para el plan 1", "con el plan 1", "mejor el 1" (caso real 20-oct: Enedino cambió del 2 al 1).
  { plan: "plan_2", pattern: /\b(quiero|prefiero|elijo|me quedo con|me interesa|mejor|me late|me conviene|escojo|tomo|seria|sera|va a ser)(?:\s+el)?\s+plan\s*(2|dos)\b|^(?:(?:y|pero|si|mejor)\s+)?(?:para|con|en)?\s*(?:el\s+)?plan\s*(2|dos)(?:\s+(?:por favor|porfa|mejor|esta bien|entonces))?[ .!]*$|\bmejor el (?:2|dos)\b/ },
  { plan: "plan_1", pattern: /\b(quiero|prefiero|elijo|me quedo con|me interesa|mejor|me late|me conviene|escojo|tomo|seria|sera|va a ser)(?:\s+el)?\s+plan\s*(1|uno)\b|^(?:(?:y|pero|si|mejor)\s+)?(?:para|con|en)?\s*(?:el\s+)?plan\s*(1|uno)(?:\s+(?:por favor|porfa|mejor|esta bien|entonces))?[ .!]*$|\bmejor el (?:1|uno)\b/ },
];

const PAUSE_PATTERNS = [
  /\b(lo voy a pensar|dejame pensarlo|lo pienso|mas tarde|despues)\b/,
  /\bpor ahora no\b/,
  /\bsolo estoy preguntando\b/,
  /\bsolo quiero informacion\b/,
];

const PRICE_OBJECTION_PATTERNS = [
  /\b(caro|muy caro|se me hace caro|esta caro|no me alcanza|no tengo ese dinero)\b/,
  /\b(hay algo mas barato|descuento|promocion)\b/,
];

const PLAN_2_SIGNALS = [
  /\bafore\b/,
  /\binfonavit\b/,
  /\bcredito (de )?vivienda\b/,
  /\bcredito infonavit\b/,
  /\bpuntos (de )?infonavit\b/,
];

const PLAN_1_SIGNALS = [
  /\bservicio medico\b/,
  /\bseguro medico\b/,
  /\bsemanas cotizadas\b/,
  /\bseguir cotizando\b/,
  /\bbeneficiarios?\b/,
  /\bguarderia\b/,
  /\bmaternidad\b/,
];

const INTEREST_PATTERNS = [
  /\bme interesa\b/,
  /\bsuena bien\b/,
  /\bme sirve\b/,
  /\bcreo que si\b/,
  /\bquiero saber mas\b/,
];

export const SALES_STAGES = Object.freeze([
  "exploring",
  "qualified",
  "plan_recommended",
  "explaining",
  "objection_handling",
  "interested",
  "authorized",
  "handoff",
]);

export function detectExplicitPlanSelection(text) {
  const value = norm(text);
  if (negatesCommitment(value)) return null;
  const match = PLAN_SELECTION_PATTERNS.find(item => item.pattern.test(value));
  return match?.plan || null;
}

export function detectPlanPreference(text) {
  const value = norm(text);
  const explicitSelection = detectExplicitPlanSelection(value);
  if (explicitSelection) return explicitSelection;

  const mentionsPlan1 = /\bplan\s*(1|uno)\b/.test(value);
  const mentionsPlan2 = /\bplan\s*(2|dos)\b/.test(value);
  if (mentionsPlan1 && mentionsPlan2) return null;

  // "Todo menos Infonavit"; "Ya tengo mi afore y mi seguro" dice lo que tiene, no lo que busca (19 y 20-oct).
  if (/\b(?:ya\s+)?(?:tengo|cuento con)\s+(?:mi\s+|una\s+|mis\s+)?(?:afore|infonavit|credito)\b/.test(value) && !/\b(?:aportar|aportaciones|sumar|puntos|quiero|me interesa)\b/.test(value)) return null;
  // "Me dieron el dinero y el aforé" (ya retiró su AFORE, caso real 21-oct).
  if (/\b(?:me dieron|me entregaron|retire|saque|cobre)\b.{0,30}\b(?:afore|dinero)\b/.test(value)) return null;
  const rejectsPlan2Need = /\b(no|sin|menos|excepto|salvo)\b.{0,30}\b(afore|infonavit|credito|puntos)\b/.test(value)
    || /\b(afore|infonavit)\b.{0,30}\b(no me interesa|no quiero|no necesito)\b/.test(value);

  if (rejectsPlan2Need) return "plan_1";
  if (hasAny(value, PLAN_2_SIGNALS)) return "plan_2";
  if (hasAny(value, PLAN_1_SIGNALS)) return "plan_1";
  return null;
}

export function detectAuthorization(text) {
  const value = norm(text);
  if (!value || hasAny(value, PAUSE_PATTERNS) || negatesCommitment(value)) return false;
  return hasAny(value, AUTHORIZATION_PATTERNS);
}

export function detectAltaInterest(text) {
  const value = norm(text);
  if (!value || hasAny(value, PAUSE_PATTERNS) || negatesCommitment(value)) return false;
  return hasAny(value, ALTA_INTEREST_PATTERNS);
}

function commercialContextReady(memory = {}) {
  const cycle = memory.sales_cycle || {};
  return Boolean(
    cycle.selected_plan ||
    cycle.recommended_plan ||
    // Mia ya recomendó o explicó un plan y preguntó "¿Quieres que iniciemos tu trámite?"
    // (venta real del 17-oct: el "Si" no abría el expediente y la IA improvisaba).
    (cycle.pitched_plans || []).length || (cycle.explained_plans || []).length ||
    ["plan_recommended", "explaining", "objection_handling", "interested"].includes(cycle.stage)
  );
}

export function analyzeNextSale(text, memory = {}) {
  const value = norm(text);
  const previous = memory.sales_cycle || {};
  const detectedPlan = detectPlanPreference(value);
  const explicitSelection = detectExplicitPlanSelection(value);
  const plan = detectedPlan || previous.recommended_plan || previous.selected_plan || null;
  // "Sí" justo después de "¿Quieres que iniciemos tu trámite?" también es autorización.
  const authorizationPhrase = detectAuthorization(value) || confirmsStart(text, memory);
  const altaInterest = detectAltaInterest(value);
  // "Quiero darme de alta" durante exploración expresa intención de compra, no autorización
  // operativa. NEXT solo abre expediente después de que ya existe contexto de plan/propuesta.
  // "Sí quiero, pero ahorita no tengo dinero" pospone: no es autorización.
  const authorized = authorizationPhrase && commercialContextReady(memory) && !detectDeferral(text);
  const priceObjection = hasAny(value, PRICE_OBJECTION_PATTERNS);
  const rejected = negatesCommitment(value);
  const interest = !rejected && (altaInterest || authorizationPhrase || Boolean(explicitSelection) || hasAny(value, INTEREST_PATTERNS) || genericInterest(text));

  let stage = previous.stage || "exploring";
  if (detectedPlan && ["exploring", "qualified"].includes(stage)) stage = "plan_recommended";
  if (/\b(que incluye|beneficios|diferencia|como funciona)\b/.test(value)) stage = "explaining";
  if (priceObjection) stage = "objection_handling";
  if (interest && !authorized) stage = "interested";
  if (authorized) stage = "authorized";

  // "Sí" a "¿Deseas que inicie tu trámite con el Plan 1?": el plan es el de esa pregunta,
  // aunque antes se hubiera recomendado otro (caso real 20-oct, Enedino).
  const lastQuestion = norm(String(memory?.ultima_respuesta_agente || "").split(/(?<=[.!])\s+/).filter(p => /\?/.test(p)).at(-1) || "");
  const askedPlans = [...new Set([...lastQuestion.matchAll(/\bplan\s*(1|uno|2|dos)\b/g)].map(m => /1|uno/.test(m[1]) ? "plan_1" : "plan_2"))];
  const askedPlan = authorized && askedPlans.length === 1 ? askedPlans[0] : null;
  const selectedPlan = explicitSelection
    || askedPlan
    || previous.selected_plan
    || (authorized ? previous.recommended_plan || detectedPlan || (previous.explained_plans || []).at(-1) || (previous.pitched_plans || []).at(-1) || null : null);

  const patch = {
    sales_cycle: {
      ...previous,
      stage,
      recommended_plan: detectedPlan || previous.recommended_plan || null,
      selected_plan: selectedPlan,
      interested: Boolean(previous.interested || interest),
      authorized: Boolean(previous.authorized || authorized),
      authorization_text: authorized ? String(text || "").trim() : previous.authorization_text || null,
      price_objection_count: Number(previous.price_objection_count || 0) + (priceObjection ? 1 : 0),
      last_signal_at: new Date().toISOString(),
    },
  };

  return {
    patch,
    stage,
    recommendedPlan: plan,
    selectedPlan,
    authorized,
    authorizationPhrase,
    altaInterest,
    priceObjection,
    interested: interest,
  };
}

export function commercialInstruction(memory = {}) {
  const cycle = memory.sales_cycle || {};
  const plan = cycle.selected_plan || cycle.recommended_plan;
  const planText = plan === "plan_2"
    ? "El plan seleccionado/recomendado es Plan 2 ($1,500 MXN mensuales)."
    : plan === "plan_1"
      ? "El plan seleccionado/recomendado es Plan 1 ($1,100 MXN mensuales)."
      : "Aún no hay plan recomendado.";

  return `ESTADO COMERCIAL NEXT:\n- etapa: ${cycle.stage || "exploring"}\n- ${planText}\n- interesado: ${Boolean(cycle.interested)}\n- autorizado: ${Boolean(cycle.authorized)}\nReglas: responde primero la duda explícita. Recomienda Plan 1 para servicio médico/semanas/beneficiarios y Plan 2 cuando también busca AFORE o INFONAVIT. Elegir o preguntar por un plan NO equivale a autorizar el trámite. No solicites CURP/NSS como objetivo de venta antes de autorización. "Quiero darme de alta" durante exploración expresa interés y NO autoriza abrir expediente: primero explica/recomienda el plan y precio. No declares autorización por inferencia. Solo considera autorización operativa cuando ya existe contexto comercial de plan/propuesta y el cliente después expresa claramente que desea iniciar/proceder con el trámite. Si autorizado=true, no sigas vendiendo ni hagas más preguntas: prepara el expediente operativo.`;
}

export function enforceAuthorizedHandoff(decision, memory = {}) {
  if (!memory.sales_cycle?.authorized) return decision;
  return {
    ...decision,
    handoff: true,
    handoff_reason: decision?.handoff_reason || "El cliente autorizó iniciar el trámite.",
    question_key: null,
  };
}
