const LABELS = Object.freeze({
  curp: "CURP",
  nss: "NSS",
  ine: "INE",
  csf: "Constancia de Situación Fiscal",
});

const PROMPTS = Object.freeze({
  curp: "Para continuar con tu expediente, compárteme por favor la CURP del titular. Si no la tienes a la mano, puedes enviarme una foto clara de la INE del titular como alternativa.",
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

// Estado completo del expediente para la memoria de la conversación. Lo usan el bridge de
// Operations y ensureAuthorizedSale: si uno de los dos guardara solo los documentos, se
// borrarían las banderas de validación/vigencia/pago y Mia volvería a avisar "expediente
// completo" a un cliente que ya está en Cobranza (caso real 19-oct).
export function operationsMemoryFromSale(sale = {}) {
  return {
    sale_id: sale.sale_id, status: sale.status, queue: sale.queue,
    validation_approved: Boolean(sale.validation?.approved), validation_rejected: Boolean(sale.validation?.rejected), validation_correction: sale.validation?.correction || null,
    call_requested_at: sale.capture?.call_requested_at || null,
    validity_confirmed: Boolean(sale.validity?.confirmed), validity_confirmed_at: sale.validity?.confirmed_at || null, validity_confirmed_by: sale.validity?.confirmed_by || null, validity_issue: sale.validity?.issue || null, validity_document_name: sale.validity?.document_name || null, validity_awaiting_reply: Boolean(sale.validity?.awaiting_customer_reply),
    payment_requested: Boolean(sale.payment?.requested), payment_requested_at: sale.payment?.requested_at || null, payment_due_date: sale.payment?.due_date || null, payment_accounts_image_name: sale.payment?.accounts_image_name || null,
    payment_received: Boolean(sale.payment?.received), payment_received_at: sale.payment?.received_at || null, payment_reference: sale.payment?.reference || null, payment_proof_name: sale.payment?.proof_name || null, payment_issue: sale.payment?.issue || null,
    payment_validated: Boolean(sale.payment?.validated), payment_validated_at: sale.payment?.validated_at || null, payment_validated_by: sale.payment?.validated_by || null,
    completed_at: sale.completed_at || null,
    ...onboardingStateFromSale(sale),
    updated_at: sale.updated_at,
  };
}

// Estados en los que el expediente ya salió de Captura: el aviso de "expediente completo" ya no aplica.
const PAST_CAPTURE = new Set(["alta_processed", "waiting_validation", "validation_in_progress", "validation_approved", "validation_rejected", "waiting_validity", "validity_confirmed", "validity_issue", "payment_requested", "payment_received", "payment_issue", "payment_validated", "completed", "cancelled"]);

export const CALL_ACK_TEXT = "Gracias, ya le pasé tu respuesta al asesor y te llamará a este número. Cualquier cosa, aquí sigo.";

export const ONBOARDING_COMPLETE_TEXT = "Listo, ya tengo los datos y documentos requeridos. Tu expediente está completo y quedó listo para que el área de Captura proceda con el alta. Te avisaré por aquí conforme avance.";

// Qué decirle a un cliente con expediente completo según dónde va su trámite en Operations.
export function operationsStatusText(ops = {}) {
  if (ops.payment_validated || ops.status === "completed" || ops.status === "payment_validated") return "Tu proceso ya quedó completado. Cualquier duda, nuestro equipo de Atención a Clientes te apoya por este medio.";
  if (ops.payment_received || ops.status === "payment_received") return "Ya recibimos tu comprobante y lo estamos validando; te confirmo por aquí en cuanto quede aplicado.";
  if (ops.payment_requested || ops.status === "payment_requested") return "Para continuar solo falta tu pago. Cuando lo realices, envíame por aquí tu comprobante, por favor.";
  if (ops.validity_confirmed || ops.status === "validity_confirmed") return "Tu afiliación ya está vigente. En breve te comparto los datos para realizar tu primer pago.";
  if (ops.validation_approved) return "Tu validación ya fue aprobada; estamos esperando la confirmación de vigencia ante el IMSS. Te aviso por aquí en cuanto quede.";
  return "Tu expediente está completo y tu alta está en proceso. Te aviso por aquí conforme avance.";
}

function isCourtesyText(text = "") {
  const raw = String(text || "").trim();
  if (/[?¿]/.test(raw)) return false;
  const v = norm(raw).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return !v || /^(?:(?:ok|okey|okay|oki|oi|va|sale|vale|si|claro|listo|perfecto|bien|muy bien|de acuerdo|entendido|enterado|gracias|muchas gracias|mil gracias|que amable|quedo pendiente|quedo al pendiente|quedo atento|quedo atenta|pendiente|igualmente|bendiciones|buen dia|excelente|mia)\s*)+$/.test(v);
}

export function buildOnboardingDecision(memory = {}, combinedText = "") {
  if (!memory.sales_cycle?.authorized || !memory.operations?.sale_id) return null;
  // Captura pidió una llamada: la respuesta del cliente (su horario) se agradece una vez.
  const callAt = Date.parse(memory.operations.call_requested_at || "");
  if (Number.isFinite(callAt) && Date.now() - callAt < 48 * 3600 * 1000 && !(Date.parse(memory.call_ack_at || "") > callAt)
    && String(combinedText || "").trim() && !hasCurpValue(combinedText) && !hasNssValue(combinedText)
    && !/[?¿]/.test(combinedText) && !/\b(?:ine|curp|nss|documento|documentos|foto|fotos|archivo)\b/.test(norm(combinedText))) {
    return { reply: CALL_ACK_TEXT, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_status: true, priority: true };
  }
  if (memory.operations.documents_complete) {
    const last = String(memory.ultima_respuesta_agente || "").trim();
    // La primera vez se avisa que el expediente quedó completo. Después ya no se repite a cada
    // "Ok" o "Gracias" (ventas reales del 17-oct): se contesta el estado del trámite o nada.
    const ops = memory.operations;
    const advanced = ops.validation_approved || ops.validity_confirmed || ops.payment_requested || ops.payment_received || ops.payment_validated
      || PAST_CAPTURE.has(String(ops.status || "")) || ["validation", "validity", "payment", "completed"].includes(String(ops.queue || ""));
    if (!memory.onboarding_complete_notified && !advanced && last !== ONBOARDING_COMPLETE_TEXT) {
      return { reply: ONBOARDING_COMPLETE_TEXT, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_status: true };
    }
    // Con el expediente completo, Mia solo contesta si el cliente pregunta algo o habla de su pago;
    // a "Ok", "Gracias", "RECIBO77" o similares no responde (los avisos de cada etapa los manda
    // Operaciones). Caso real Jesús Miguel, 17-19 oct.
    // En Cobranza: "¿Cuánto tengo que pagar?" → su monto, no los dos planes; "ayer no pude, lo hago
    // en un ratito" → sin problema (caso real 19 y 20-oct, Jesús Miguel).
    const paying = ops.payment_requested || ops.status === "payment_requested" || ops.status === "payment_issue";
    if (paying && !ops.payment_received) {
      const t = norm(combinedText);
      const plan = memory.sales_cycle?.selected_plan || memory.sales_cycle?.recommended_plan || null;
      const amount = plan === "plan_2" ? "$1,500 MXN, del Plan 2" : plan === "plan_1" ? "$1,100 MXN, del Plan 1" : null;
      if (amount && /\b(?:cuanto|monto|cantidad|importe|cuanto es|cuanto seria|cuanto pago|cuanto le deposito)\b/.test(t)) {
        return { reply: `Tu pago es de ${amount}. Cuando lo realices, envíame por aquí tu comprobante, por favor.`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_status: true, priority: true };
      }
      if (/\b(?:no pude|no he podido|no alcance|lo hago|lo realizo|deposito|pago|hago el deposito|hago el pago)\b.{0,40}\b(?:ratito|rato|al rato|mas tarde|manana|hoy|en la tarde|en un momento|ahorita|despues|luego)\b|\b(?:ahorita|al rato|mas tarde|manana|en un ratito)\b.{0,25}\b(?:deposito|pago|lo hago|lo realizo)\b/.test(t)) {
        return { reply: "Claro, sin problema. Cuando lo realices, envíame por aquí tu comprobante, por favor.", question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_status: true, priority: true };
      }
    }
    const status = operationsStatusText(memory.operations);
    const asks = /[?¿]/.test(combinedText) || /\b(cuando|como va|como vamos|que sigue|ya quedo|ya esta|estatus|status|avance|pago|pague|pagar|deposit\w*|transferi\w*|comprobante|vigencia|alta)\b/.test(norm(combinedText));
    const question = /[?¿]/.test(combinedText);
    const thanks = /\b(gracias|que tenga|buen dia|excelente dia|bendiciones)\b/.test(norm(combinedText));
    const reply = !asks || isCourtesyText(combinedText) || (thanks && !question) || (last === status && !question) ? "" : status;
    return { reply, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_status: true };
  }

  const text = norm(combinedText);
  const curpPending = memory.operations.onboarding_next === "curp" || memory.operations.documents_missing?.[0] === "curp";
  const saysNoCurp = /\b(no tengo|no cuento con|no se|no recuerdo|no conozco|no encuentro|no la tengo|no la se)\b.{0,35}\bcurp\b|\bcurp\b.{0,35}\b(no la tengo|no la se|no la recuerdo|no la encuentro)\b/.test(text);
  if (curpPending && saysNoCurp) {
    return {
      reply: "No te preocupes. Si no tienes la CURP a la mano, envíame una foto clara de la INE del titular y podemos usarla como alternativa para continuar integrando el expediente.",
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
      onboarding_requirement: "ine",
    };
  }
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
    return {
      reply: nssResolution === "request_new"
        ? "Perfecto, ya recibimos tu documentación. Podemos continuar con tu trámite. Como nos indicaste que nunca has tenido NSS, podemos solicitar uno nuevo para integrar tu expediente. Este proceso puede tomar de 3 a 7 días."
        : "Perfecto, ya recibimos tu documentación. Podemos continuar con tu trámite. No te preocupes por el NSS; con tu CURP podemos localizarlo y agregarlo a tu expediente para que el proceso continúe sin retrasos.",
      question_key:null,add_labels:[],remove_labels:[],handoff:false,handoff_reason:"",onboarding_requirement:null
    };
  }
  const looksLikeQuestion = /\?|\b(cuanto|cuánto|como|cómo|cuando|cuándo|donde|dónde|por que|por qué|puedo|puede|incluye|cuesta|tarda|pago|proceso)\b/.test(text);
  const containsRequestedData = hasCurpValue(combinedText) || hasNssValue(combinedText);
  if (looksLikeQuestion && !containsRequestedData) return null;

  const key = memory.operations.onboarding_next || memory.operations.documents_missing?.[0] || null;
  if (!key) return null;
  // "Ok", "Permítame" a la solicitud del documento: no repetir la misma solicitud palabra por palabra.
  const samePrompt = String(memory.ultima_respuesta_agente || "").trim() === onboardingPrompt(key);
  if (samePrompt && !containsRequestedData && isCourtesyText(combinedText)) {
    return { reply: "", question_key: key === "curp" || key === "nss" ? key : null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", onboarding_requirement: key };
  }
  return {
    reply: onboardingPrompt(key),
    question_key: key === "curp" || key === "nss" ? key : null,
    add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    onboarding_requirement: key,
  };
}

export function onboardingLabel(key) { return LABELS[key] || key; }
