import { negatesCommitment } from "./commitment-negation.js";
import { confirmsStart, genericInterest } from "./start-confirmation.js";
import { detectDeferral } from "./customer-deferral.js";

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function planLabel(plan) { return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : "el plan"; }
function planPrice(plan) { return plan === "plan_2" ? "$1,500 MXN mensuales" : plan === "plan_1" ? "$1,100 MXN mensuales" : null; }

// "Pues iniciar trámite" (caso real 21-oct) también es iniciar.
const START_RE = /^(?:(?:pues|si|ok|bueno|entonces|claro|va|vamos a|ya)[ ,]*)*(?:iniciar|empezar|comenzar|arrancar)(?:le)?\s+(?:con\s+)?(?:el\s+|mi\s+)?(?:tramite|proceso|alta)\b|\b(?:si[, ]*)?(?:quiero|deseo|podemos|quiero que)\s+(?:iniciar|empezar|proceder|continuar|hacer)\s+(?:con\s+)?(?:el\s+)?(?:tramite|proceso|alta)|\b(?:iniciemos|empecemos|empezemos|procedamos)\b|\badelante con (?:el )?(?:tramite|proceso|alta)\b|\b(?:si[, ]*)?me interesa[, ]+(?:iniciemos|empecemos|empezemos|procedamos)(?:\s+(?:con )?(?:el )?(?:tramite|proceso|alta))?\b/;
// También "Para el plan 1", "con el plan 2", "mejor el 1" (caso real 20-oct).
const SELECTION_RE = /\b(?:me quedo con|elijo|prefiero|escojo|seria|sera|va a ser)(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b|^(?:(?:y|pero|si|mejor)\s+)?(?:para|con|en)\s+(?:el\s+)?plan\s*(1|uno|2|dos)(?:\s+(?:por favor|porfa|mejor|entonces))?[ .!]*$|\bmejor el (?:plan\s*)?(?:1|uno|2|dos)\b/;
const INTEREST_ONLY_RE = /\bme interesa(?:\s+(?:adquirir|contratar|tomar|elegir|escoger))?(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b|\b(?:quiero|deseo)\s+(?:adquirir|contratar|tomar)(?:\s+el)?\s+plan\s*(1|uno|2|dos)\b/;

export function commitmentDecision(memory = {}, combinedText = "") {
  const text = norm(combinedText);
  const cycle = memory.sales_cycle || {};
  const plan = cycle.selected_plan || cycle.recommended_plan || null;
  if (!text || cycle.authorized || negatesCommitment(text) || detectDeferral(combinedText)) return null;

  if ((START_RE.test(text) || confirmsStart(combinedText, memory)) && plan) {
    return {
      reply: `Perfecto. Confirmo que deseas iniciar el trámite con ${planLabel(plan)}${planPrice(plan) ? ` de ${planPrice(plan)}` : ""}. Voy a abrir tu expediente y comenzaremos con los datos y documentos necesarios.`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "authorized",
    };
  }

  if (SELECTION_RE.test(text) && plan) {
    return {
      reply: `Perfecto, dejamos seleccionado el ${planLabel(plan)}${planPrice(plan) ? ` de ${planPrice(plan)}` : ""}. ¿Quieres que iniciemos tu trámite con el ${planLabel(plan)}?`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "selected",
    };
  }

  // "Sí me interesa" con un plan ya en conversación: avanzar al cierre en vez de
  // volver a recomendar el mismo plan.
  if (genericInterest(combinedText) && plan) {
    return {
      reply: `¡Qué bien! Entonces seguimos con ${planLabel(plan)}${planPrice(plan) ? ` de ${planPrice(plan)}` : ""}. ¿Quieres que iniciemos tu trámite? Si antes tienes alguna duda, con gusto te la resuelvo.`,
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      commitment: "interested",
      selected_plan: plan,
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
