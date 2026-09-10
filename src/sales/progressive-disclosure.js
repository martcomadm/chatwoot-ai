function norm(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

const PRICE_RE = /(?:\$\s*1[,.]?100|\$\s*1[,.]?500|1[,.]?100\s*(?:mxn|pesos)?|1[,.]?500\s*(?:mxn|pesos)?)/i;
const BOTH_PLANS_RE = /plan\s*1[\s\S]{0,500}plan\s*2|plan\s*2[\s\S]{0,500}plan\s*1/i;
const DETAIL_RE = /(?:salario diario|\$\s*480|5[.,]15\s*%|48\s*horas|incapacidades|documentaci[oó]n)/i;
const PRICE_QUESTION_RE = /\b(precio|precios|cuanto cuesta|cuanto sale|costo|costos|planes|plan 1|plan 2)\b/;
const DIRECT_DETAIL_RE = /\b(que incluye|beneficios|diferencia|como funciona|salario diario|incapacidad|tiempo|cuanto tarda|requisitos|documentos)\b/;
const DETAIL_TOPIC_RE = /\b(afore|infonavit)\b/;
const QUESTION_CUE_RE = /[?¿]|\b(que|cual|cuales|como|cuanto|cuanta|cuantos|cuantas|tienen|incluye|manejan|ofrecen|aplica|sirve)\b/;

export function isEarlyCommercialStage(memory = {}) {
  const stage = memory?.sales_cycle?.stage || "exploring";
  return !memory?.sales_cycle?.authorized && ["exploring", "qualified", "interested", "plan_recommended", "explaining"].includes(stage);
}

export function customerAskedCommercialDetails(text) {
  const value = norm(text);
  if (PRICE_QUESTION_RE.test(value) || DIRECT_DETAIL_RE.test(value)) return true;
  return DETAIL_TOPIC_RE.test(value) && QUESTION_CUE_RE.test(value);
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

function effectivePlan(memory = {}) {
  if (memory?.sales_cycle?.selected_plan) return memory.sales_cycle.selected_plan;
  if (memory?.sales_cycle?.recommended_plan) return memory.sales_cycle.recommended_plan;
  const need = memory?.commercial_need || {};
  if (need.afore_infonavit) return "plan_2";
  if (need.service_medical || need.weeks || need.retirement) return "plan_1";
  return null;
}

export function compactPlanRecommendation(memory = {}, combinedText = "") {
  if (memory?.sales_cycle?.authorized || customerAskedCommercialDetails(combinedText)) return null;
  const plan = effectivePlan(memory);
  const needText = norm(`${memory?.necesidad_principal || ""} ${combinedText || ""}`);
  const structured = memory?.commercial_need || {};
  const pending = pendingQuestion(memory);
  const retirementContext = Boolean(structured.retirement) || /\b(pension|pensionarme|retiro|jubilarme|jubilacion)\b/.test(needText);
  const weeksContext = Boolean(structured.weeks) || /\b(semanas|cotizar|cotizando|seguir cotizando|recuperar semanas)\b/.test(needText);
  const serviceContext = Boolean(structured.service_medical) || /\b(servicio medico|seguro medico|medico|beneficiarios|guarderia|maternidad)\b/.test(needText);
  const plan2Context = Boolean(structured.afore_infonavit) || /\b(afore|infonavit|credito|vivienda|puntos)\b/.test(needText);

  if (plan === "plan_1" && retirementContext && weeksContext) {
    return {
      reply: "Entiendo. Si tu objetivo es seguir cotizando semanas pensando en tu futura pensión, el Plan 1 puede ser una opción para continuar cotizando y además contar con servicio médico del IMSS. Tiene un costo de $1,100 MXN. Si quieres, te explico cómo funciona y qué conviene revisar en tu caso antes de iniciar.",
      question_key: null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  if (plan === "plan_1" && (serviceContext || weeksContext)) {
    return {
      reply: serviceContext
        ? `Perfecto. Si lo que buscas principalmente es servicio médico, el Plan 1 puede ser una buena opción. Tiene un costo de $1,100 MXN e incluye servicio médico del IMSS y continuación de semanas cotizadas; también permite registrar beneficiarios conforme a las reglas del IMSS.${pending ? ` ${pending.text}` : " ¿Quieres que te explique cómo funciona?"}`
        : `Entiendo. Si tu prioridad es continuar cotizando semanas, el Plan 1 puede ajustarse a lo que buscas. Tiene un costo de $1,100 MXN e incluye continuación de semanas y servicio médico del IMSS.${pending ? ` ${pending.text}` : " ¿Quieres que te explique cómo funciona?"}`,
      question_key: pending?.key || null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  if (plan === "plan_2" && plan2Context) {
    return {
      reply: `Perfecto. Si también te interesa AFORE e INFONAVIT, el Plan 2 puede ajustarse mejor a lo que buscas. Tiene un costo de $1,500 MXN e incluye servicio médico y continuación de semanas, además de aportaciones a AFORE y acumulación de puntos para INFONAVIT.${pending ? ` ${pending.text}` : " ¿Quieres que te explique cómo funciona?"}`,
      question_key: pending?.key || null,
      add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    };
  }
  return null;
}
