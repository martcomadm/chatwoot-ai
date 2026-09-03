const LABELS = Object.freeze({
  curp: "CURP",
  nss: "NSS",
  ine: "INE",
  csf: "Constancia de Situación Fiscal",
});

const PROMPTS = Object.freeze({
  curp: "Para continuar con tu expediente, compárteme por favor la CURP del titular.",
  nss: "Gracias. Ahora compárteme por favor el NSS del titular.",
  ine: "Perfecto. Ahora envíame una foto o archivo claro de la INE del titular.",
  csf: "Muy bien. Solo falta la Constancia de Situación Fiscal. Envíamela por aquí en foto o PDF, por favor.",
});

function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasCurpValue(text) {
  return /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i.test(String(text || "").replace(/\s+/g, ""));
}

function hasNssValue(text) {
  const digits = String(text || "").replace(/\D/g, "");
  return digits.length === 11;
}

export function nextOnboardingRequirement(saleOrOperations = {}) {
  const missing = saleOrOperations.documents?.missing || saleOrOperations.documents_missing || [];
  return Array.isArray(missing) && missing.length ? missing[0] : null;
}

export function onboardingPrompt(key) {
  return PROMPTS[key] || "Para continuar necesito completar la documentación pendiente de tu expediente.";
}

export function onboardingStateFromSale(sale = {}) {
  const missing = Array.isArray(sale.documents?.missing) ? sale.documents.missing : [];
  return {
    documents_complete: Boolean(sale.documents?.complete),
    documents_missing: missing,
    documents_received: Number(sale.documents?.checklist?.received_count || 0),
    documents_required: Number(sale.documents?.checklist?.required_count || 4),
    onboarding_next: missing[0] || null,
    onboarding_active: !sale.documents?.complete,
  };
}

export function buildOnboardingDecision(memory = {}, combinedText = "") {
  if (!memory.sales_cycle?.authorized || !memory.operations?.sale_id) return null;
  if (memory.operations.documents_complete) {
    return {
      reply: "Listo, ya tengo los datos y documentos requeridos. Tu expediente está completo y quedó listo para que el área de Captura proceda con el alta. Te avisaré por aquí conforme avance.",
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }

  const text = norm(combinedText);
  const looksLikeQuestion = /\?|\b(cuanto|cuánto|como|cómo|cuando|cuándo|donde|dónde|por que|por qué|puedo|puede|incluye|cuesta|tarda|pago|proceso)\b/.test(text);
  const containsRequestedData = hasCurpValue(combinedText) || hasNssValue(combinedText);
  if (looksLikeQuestion && !containsRequestedData) return null;

  const key = memory.operations.onboarding_next || memory.operations.documents_missing?.[0] || null;
  if (!key) return null;
  return {
    reply: onboardingPrompt(key),
    question_key: key === "curp" || key === "nss" ? key : null,
    add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    onboarding_requirement: key,
  };
}

export function onboardingLabel(key) { return LABELS[key] || key; }
