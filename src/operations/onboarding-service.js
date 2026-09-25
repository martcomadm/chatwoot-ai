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
  csf: "La Constancia de Situación Fiscal no es necesaria para iniciar. Se solicitará más adelante, una vez que cumplas 3 meses con nosotros.",
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
    documents_required: Number(sale.documents?.checklist?.required_count || 3),
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
  const nssResolution = memory?.operations?.nss_resolution || memory?.nss_resolution || null;
  const saysNoNss = /\b(no tengo|no cuento con|no se|no recuerdo|no conozco|no encuentro)\b.{0,30}\bnss\b/.test(text);
  const saysNeverHadNss = /\b(nunca|jamas)\b.{0,25}\b(?:he tenido|tuve|he contado con|me han dado|me asignaron)?\s*nss\b|\bnunca he tenido seguro\b/.test(text);
  if ((memory.operations.onboarding_next === "nss" || memory.operations.documents_missing?.[0] === "nss") && (saysNoNss || saysNeverHadNss)) {
    return {
      reply: saysNeverHadNss
        ? "No te preocupes. Si nunca has tenido NSS, podemos solicitar uno nuevo y continuar con tu trámite. Este proceso puede tardar aproximadamente de 3 a 7 días. Por ahora podemos seguir integrando tu expediente con tu CURP y los demás documentos para no retrasarlo."
        : "No te preocupes. Si no tienes tu NSS a la mano, con tu CURP podemos localizarlo. El área de Captura puede agregarlo al expediente para que no se retrase tu trámite. Podemos continuar con los demás documentos pendientes.",
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      onboarding_requirement: "nss",
      nss_resolution: saysNeverHadNss ? "request_new" : "lookup_by_curp",
    };
  }
  if ((memory.operations.onboarding_next === "nss" || memory.operations.documents_missing?.[0] === "nss") && nssResolution) {
    const remaining=(memory.operations.documents_missing||[]).find(key=>key!=="nss");
    if(remaining)return {reply:onboardingPrompt(remaining),question_key:remaining==="curp"?remaining:null,add_labels:[],remove_labels:[],handoff:false,handoff_reason:"",onboarding_requirement:remaining};
    return {reply:"Perfecto. Con esto podemos continuar integrando tu expediente mientras Captura resuelve el NSS.",question_key:null,add_labels:[],remove_labels:[],handoff:false,handoff_reason:"",onboarding_requirement:null};
  }
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
