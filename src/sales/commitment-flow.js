import { negatesCommitment } from "./commitment-negation.js";

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function planLabel(plan) { return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : "el plan"; }
function planPrice(plan) { return plan === "plan_2" ? "$1,500 MXN" : plan === "plan_1" ? "$1,100 MXN" : null; }

const START_RE = /\b(?:si[, ]*)?(?:quiero|deseo|podemos|quiero que)\s+(?:iniciar|empezar|proceder|continuar|hacer)\s+(?:con\s+)?(?:el\s+)?(?:tramite|proceso|alta)|\b(?:iniciemos|empecemos|empezemos|procedamos)\b|\badelante con (?:el )?(?:tramite|proceso|alta)\b|\b(?:si[, ]*)?me interesa[, ]+(?:iniciemos|empecemos|empezemos|procedamos)(?:\s+(?:con )?(?:el )?(?:tramite|proceso|alta))?\b/;
const SELECTION_RE = /\b(?:me quedo con|elijo|prefiero|escojo)(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b/;
const INTEREST_ONLY_RE = /\bme interesa(?:\s+(?:adquirir|contratar|tomar|elegir|escoger))?(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b|\b(?:quiero|deseo)\s+(?:adquirir|contratar|tomar)(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b/;

export function commitmentDecision(memory = {}, combinedText = "") {
  const text = norm(combinedText);
  const cycle = memory.sales_cycle || {};
  const plan = cycle.selected_plan || cycle.recommended_plan || null;
  if (!text || cycle.authorized || negatesCommitment(text)) return null;

  if (START_RE.test(text) && plan) {
    return {
      reply: `Perfecto. Confirmo que deseas iniciar el trámite con ${planLabel(plan)}${planPrice(plan) ? ` de ${planPrice(plan)}` : ""}. Voy a abrir tu expediente y comenzaremos con los datos y documentos necesarios.`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "authorized",
    };
  }

  if (SELECTION_RE.test(text) && plan) {
    return {
      reply: `Perfecto, dejamos seleccionado ${planLabel(plan)}${planPrice(plan) ? ` de ${planPrice(plan)}` : ""}. Si tienes alguna duda antes de iniciar, con gusto la resolvemos. Cuando estés listo para comenzar el trámite, solo indícame que deseas iniciarlo.`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "selected",
    };
  }

  if (INTEREST_ONLY_RE.test(text)) {
    const explicit = text.match(/\bplan\s*(1|uno|2|dos)\b/)?.[1];
    const interestedPlan = explicit ? (/^(2|dos)$/.test(explicit) ? "plan_2" : "plan_1") : plan;
    if (!interestedPlan) return null;
    return {
      reply: `Perfecto. Veo que te interesa ${planLabel(interestedPlan)}${planPrice(interestedPlan) ? ` de ${planPrice(interestedPlan)}` : ""}. Si deseas continuar con la contratación, puedo guiarte con el siguiente paso. ¿Quieres que comencemos?`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "interested",
      selected_plan: interestedPlan,
    };
  }
  return null;
}
