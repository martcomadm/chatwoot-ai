function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

const PRICE_RE = /(?:\$\s*1[,.]?100|\$\s*1[,.]?500|1[,.]?100\s*(?:mxn|pesos)?|1[,.]?500\s*(?:mxn|pesos)?)/i;
const BOTH_PLANS_RE = /plan\s*1[\s\S]{0,500}plan\s*2|plan\s*2[\s\S]{0,500}plan\s*1/i;
const DETAIL_RE = /(?:salario diario|\$\s*480|5[.,]15\s*%|48\s*horas|incapacidades|documentaci[oó]n)/i;
const PRICE_QUESTION_RE = /\b(precio|precios|cuanto cuesta|cuanto sale|costo|costos|planes|plan 1|plan 2)\b/;
const DETAIL_QUESTION_RE = /\b(que incluye|beneficios|diferencia|como funciona|afore|infonavit|salario diario|incapacidad|tiempo|cuanto tarda|requisitos|documentos)\b/;

export function isEarlyCommercialStage(memory = {}) {
  const stage = memory?.sales_cycle?.stage || "exploring";
  return !memory?.sales_cycle?.authorized && ["exploring", "qualified", "interested"].includes(stage);
}

export function customerAskedCommercialDetails(text) {
  const value = norm(text);
  return PRICE_QUESTION_RE.test(value) || DETAIL_QUESTION_RE.test(value);
}

export function isInformationOpening(text) {
  const value = norm(text);
  return /\b(quiero|quisiera|necesito|me gustaria|dame|busco)\b.{0,35}\b(informacion|saber mas|orientacion)\b/.test(value)
    || /\binformacion\b.{0,30}\b(afiliacion|imss)\b/.test(value);
}

export function disclosureViolations(reply, { memory = {}, combinedText = "" } = {}) {
  if (!isEarlyCommercialStage(memory) || customerAskedCommercialDetails(combinedText)) return [];
  const text = String(reply || "");
  const reasons = [];
  if (BOTH_PLANS_RE.test(text)) reasons.push("catalogo_completo_prematuro");
  if (PRICE_RE.test(text)) reasons.push("precio_no_solicitado_en_apertura");
  if (DETAIL_RE.test(text)) reasons.push("detalle_operativo_prematuro");
  return reasons;
}

export function progressiveOpeningDecision(memory = {}, combinedText = "") {
  if (!isInformationOpening(combinedText) || !isEarlyCommercialStage(memory)) return null;
  if (customerAskedCommercialDetails(combinedText)) return null;
  if (memory?.tiene_imss === null || memory?.tiene_imss === undefined) {
    return {
      reply: "Claro, con gusto te ayudo. La afiliación puede ayudarte a contar con servicio médico del IMSS y continuar cotizando semanas. Para orientarte mejor, ¿actualmente cuentas con IMSS?",
      question_key: "tiene_imss",
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  return null;
}

function pendingQuestion(memory = {}) {
  const key = memory?.ultima_pregunta;
  if (!key) return null;
  if ((memory?.resolved_questions || []).includes(key)) return null;
  if (key === "nombre" && !memory?.nombre) return { key, text: "Para seguir orientándote, ¿me compartes tu nombre completo?" };
  if (key === "edad" && !memory?.edad) return { key, text: "Para seguir orientándote, ¿qué edad tienes?" };
  if (key === "actividad" && !memory?.actividad) return { key, text: "Para seguir orientándote, ¿a qué te dedicas actualmente?" };
  return null;
}

export function compactPlanRecommendation(memory = {}, combinedText = "") {
  if (memory?.sales_cycle?.authorized || customerAskedCommercialDetails(combinedText)) return null;
  const plan = memory?.sales_cycle?.recommended_plan;
  const need = norm(memory?.necesidad_principal || combinedText);
  const pending = pendingQuestion(memory);
  if (plan === "plan_1" && /\b(servicio medico|seguro medico|medico|semanas|beneficiarios|guarderia|maternidad)\b/.test(need)) {
    return {
      reply: `Perfecto. Si lo que buscas principalmente es servicio médico, el Plan 1 puede ser una buena opción. Tiene un costo de $1,100 MXN e incluye servicio médico del IMSS y continuación de semanas cotizadas; también permite registrar beneficiarios conforme a las reglas del IMSS.${pending ? ` ${pending.text}` : ""}`,
      question_key: pending?.key || null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  if (plan === "plan_2" && /\b(afore|infonavit|credito|vivienda|puntos)\b/.test(need)) {
    return {
      reply: `Perfecto. Por lo que buscas, el Plan 2 puede ser la opción más completa. Tiene un costo de $1,500 MXN e incluye servicio médico y continuación de semanas, además de aportaciones a AFORE y acumulación de puntos para INFONAVIT.${pending ? ` ${pending.text}` : ""}`,
      question_key: pending?.key || null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  return null;
}
