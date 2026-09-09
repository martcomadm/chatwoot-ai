function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

const MEDICAL = /\b(servicio medico|seguro medico|atencion medica|consultas|medicinas|hospital|maternidad|guarderia|beneficiarios?)\b/;
const WEEKS = /\b(semanas|cotizar|cotizando|seguir cotizando|recuperar semanas|continuar semanas)\b/;
const AFORE_INFONAVIT = /\b(afore|infonavit|credito de vivienda|credito infonavit|puntos infonavit|vivienda)\b/;
const RETIREMENT = /\b(pension|pensionarme|retiro|jubilarme|jubilacion)\b/;

export function deriveCommercialNeed(text, previous = {}) {
  const value = norm(text);
  const next = {
    service_medical: Boolean(previous.service_medical),
    weeks: Boolean(previous.weeks),
    afore_infonavit: Boolean(previous.afore_infonavit),
    retirement: Boolean(previous.retirement),
    unknown: previous.unknown !== false,
  };

  if (MEDICAL.test(value)) next.service_medical = true;
  if (WEEKS.test(value)) next.weeks = true;
  if (AFORE_INFONAVIT.test(value)) next.afore_infonavit = true;
  if (RETIREMENT.test(value)) next.retirement = true;
  next.unknown = !(next.service_medical || next.weeks || next.afore_infonavit || next.retirement);
  return next;
}

export function hasCommercialNeed(memory = {}) {
  const need = memory.commercial_need || {};
  // Only deterministic, structured signals count as commercial need. The LLM field
  // necesidad_principal may contain contextual prose (for example "desempleado") and
  // must never bypass the Need Before Recommendation guard by itself.
  return Boolean(need.service_medical || need.weeks || need.afore_infonavit || need.retirement);
}

export function needGuardDecision(memory = {}, combinedText = "") {
  if (memory?.sales_cycle?.authorized || hasCommercialNeed(memory)) return null;
  if (!memory?.nombre || !memory?.edad || !memory?.actividad) return null;

  const firstName = memory?.primer_nombre || String(memory?.nombre || "").trim().split(/\s+/)[0] || null;
  return {
    reply: `${firstName ? `${firstName}, ` : ""}para orientarte mejor, ¿qué es lo más importante para ti con la afiliación: tener servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?`,
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
  return needGuardDecision(memory, combinedText) || { ...decision, reply: "Antes de recomendarte un plan, cuéntame qué buscas principalmente con la afiliación.", question_key: "necesidad_principal" };
}
