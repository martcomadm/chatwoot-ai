// Señales de compromiso que dependen del turno anterior de Mia.
// - Interés genérico ("sí me interesa") cuando ya hay un plan en conversación.
// - Un "sí" corto justo después de que Mia preguntó si iniciamos el trámite.
import { negatesCommitment } from "./commitment-negation.js";

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// "sí me interesa", "me interesa mucho", "suena bien", "me convence", "sí, me gusta ese plan"…
// Solo frases de interés sin otro contenido: "me interesa AFORE" es una necesidad, no esto.
const GENERIC_INTEREST_RE = /^(?:(?:si|claro|ok|okay|va|sale|perfecto|bueno|excelente|muy bien)[ ,.!]*)*(?:si[ ,]*)?(?:me interesa|me gusta|me late|suena bien|me sirve|me convence|me parece bien|creo que si)(?:[ ,]*(?:mucho|bastante|si|entonces|el plan|ese plan|esa opcion|esta opcion|el plan (?:1|uno|2|dos)))?[ .!]*$/;

// Respuesta afirmativa corta: "sí", "sí, por favor", "claro", "va", "adelante", "ok, sí"…
// Incluye "muy bien", "bien", "bueno", "listo", "excelente": tras "¿iniciamos?" significan que sí.
// "Confirmo", "Sii", "si por favor" también (caso real 19-oct: "Confirmo" no abría el trámite).
const SHORT_AFFIRMATIVE_RE = /^(?:(?:si+|sip|claro|ok|okay|okey|oki|va|vale|sale|adelante|perfecto|de acuerdo|estoy de acuerdo|esta bien|por supuesto|dale|andale|orale|correcto|muy bien|bien|bueno|listo|excelente|genial|me parece bien|me parece perfecto|confirmo|lo confirmo|si confirmo|acepto)[ ,.!]*){1,3}(?:por favor|porfavor|porfa|x favor|gracias|hagamoslo|iniciemos|comencemos|empecemos|con mucho gusto|con muchisimo gusto)?[ .!🙏👍]*$/;

// Mia preguntó explícitamente si iniciamos/comenzamos el trámite o la contratación.
// Incluye las formas que usa la IA: "¿Deseas que inicie tu trámite con el Plan 1?",
// "¿Quieres que proceda con Plan 1…?", "¿Confirmas que deseas iniciar…?" (casos reales 19 y 20-oct).
const AGENT_ASKED_TO_START_RE = /(?:quieres|deseas|te gustaria|gustas) que (?:iniciemos|comencemos|empecemos|procedamos|continuemos|inicie|comience|empiece|proceda|demos de alta|te demos de alta|te de de alta|tramitemos)|(?:quieres|deseas|te gustaria) (?:iniciar|comenzar|empezar|proceder|contratar|continuar con el tramite)|confirmas que (?:deseas|quieres) (?:iniciar|comenzar|proceder)|(?:podemos|puedo) (?:iniciar|comenzar|empezar) (?:el|tu) (?:tramite|alta)|si estas de acuerdo, podemos iniciar/;

export function genericInterest(text) {
  const value = norm(text);
  return Boolean(value) && !negatesCommitment(value) && GENERIC_INTEREST_RE.test(value);
}

// "Ojalá me hiciera el favor", "Si me hace el favor", "Hágame el favor" (caso real 16-oct, con faltas).
const FAVOR_RE = /^(?:si|ojala|pues|claro)?[ ,]*(?:que )?(?:me |nos )?(?:hiciera|iciera|hicieran|haria|harias|hace|haces|hagas|haga|hagame|aga|agame)s? (?:el |ese )?(?:favor|fabor)[ .!]*(?:gracias)?[ .!]*$/;
export function shortAffirmative(text) {
  const value = norm(text);
  return Boolean(value) && !negatesCommitment(value) && (SHORT_AFFIRMATIVE_RE.test(value) || FAVOR_RE.test(value));
}

export function agentAskedToStart(memory = {}) {
  return AGENT_ASKED_TO_START_RE.test(norm(memory?.ultima_respuesta_agente || ""));
}

// "Sí" en respuesta directa a "¿Quieres que iniciemos el trámite?" equivale a autorizar.
export function confirmsStart(text, memory = {}) {
  return (shortAffirmative(text) || affirmsWithDocuments(text)) && agentAskedToStart(memory);
}

// "Si cuando Curp y nss ine ok" a "¿Quieres que inicie el trámite?" (caso real 20-oct): un sí que
// habla de mandar sus documentos también es aceptar.
export function affirmsWithDocuments(text) {
  const raw = String(text || "");
  const value = norm(raw);
  if (!value || /[?¿]/.test(raw) || negatesCommitment(value) || value.length > 90) return false;
  return /^(?:si+|claro|ok|okay|va|sale|de acuerdo|esta bien|bueno|listo|perfecto)\b/.test(value)
    && /\b(?:curp|nss|ine|documentos?|papeles|credencial|fotos?)\b/.test(value)
    && !/\b(?:no tengo|no cuento|despues|luego|manana|mas tarde|lo pienso)\b/.test(value);
}
