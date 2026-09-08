const SENSITIVE_REQUEST_RE = /\b(curp|nss|n[uú]mero\s+de\s+seguridad\s+social)\b/i;
const QUESTIONISH_RE = /[?¿]/;

function cleanActivity(text) {
  return String(text || "").trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

export function contextualActivityPatch(text, memory = {}) {
  if (memory?.ultima_pregunta !== "actividad" && memory?.flujo?.siguiente_paso !== "actividad") return null;
  const value = cleanActivity(text);
  if (!value || value.length > 100 || QUESTIONISH_RE.test(value)) return null;
  if (/\b(curp|nss|imss|infonavit|afore|plan\s*[12]|precio|cu[aá]nto|informaci[oó]n)\b/i.test(value)) return null;

  const stripped = value
    .replace(/^(?:yo\s+)?(?:trabajo|laboro)\s+(?:en|como)\s+/i, "")
    .replace(/^(?:yo\s+)?soy\s+/i, "")
    .trim();
  if (!stripped || stripped.length < 2) return null;

  return {
    actividad: stripped,
    tipo_trabajo: stripped,
    contexto_laboral: { respuesta_actividad_contextual: true },
    resolved_questions: ["actividad"],
  };
}

export function requestsSensitiveData(decision = {}) {
  return [decision.question_key, decision.reply].some(value => SENSITIVE_REQUEST_RE.test(String(value || "")));
}

export function enforcePreAuthorizationDecision(decision, { memory, planner, combinedText, fallbackDecision }) {
  if (memory?.sales_cycle?.authorized || !requestsSensitiveData(decision)) return decision;
  const safePlanner = { ...(planner || {}) };
  if (["curp", "nss"].includes(safePlanner.question_key)) safePlanner.question_key = null;
  safePlanner.action = "continuar_venta";
  safePlanner.specialized = true;
  const safe = fallbackDecision(memory, safePlanner, combinedText);
  if (requestsSensitiveData(safe)) {
    return {
      reply: "Gracias. Antes de solicitar documentos o datos sensibles, primero revisemos qué opción se adapta mejor a lo que necesitas. ¿Qué te interesa principalmente: servicio médico, semanas, INFONAVIT o AFORE?",
      question_key: "necesidad_principal",
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  return safe;
}
