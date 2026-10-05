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
const SHORT_AFFIRMATIVE_RE = /^(?:(?:si|claro|ok|okay|va|vale|sale|adelante|perfecto|de acuerdo|esta bien|por supuesto|dale|andale|correcto)[ ,.!]*){1,3}(?:por favor|porfa|gracias|hagamoslo|iniciemos|comencemos|empecemos)?[ .!]*$/;

// Mia preguntó explícitamente si iniciamos/comenzamos el trámite o la contratación.
const AGENT_ASKED_TO_START_RE = /(?:quieres|deseas|te gustaria|gustas) que (?:iniciemos|comencemos|empecemos|procedamos|continuemos)|(?:podemos|puedo) (?:iniciar|comenzar|empezar) (?:el|tu) tramite|si estas de acuerdo, podemos iniciar/;

export function genericInterest(text) {
  const value = norm(text);
  return Boolean(value) && !negatesCommitment(value) && GENERIC_INTEREST_RE.test(value);
}

export function shortAffirmative(text) {
  const value = norm(text);
  return Boolean(value) && !negatesCommitment(value) && SHORT_AFFIRMATIVE_RE.test(value);
}

export function agentAskedToStart(memory = {}) {
  return AGENT_ASKED_TO_START_RE.test(norm(memory?.ultima_respuesta_agente || ""));
}

// "Sí" en respuesta directa a "¿Quieres que iniciemos el trámite?" equivale a autorizar.
export function confirmsStart(text, memory = {}) {
  return shortAffirmative(text) && agentAskedToStart(memory);
}
