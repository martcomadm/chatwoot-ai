function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

const AUTHORIZATION_PATTERNS = [
  /\bquiero (contratar|iniciar|hacerlo|proceder|continuar|darme de alta|dar de alta|empezar)\b/,
  /\badelante con (el )?(tramite|proceso|alta)\b/,
  /\b(iniciemos|empecemos|procedamos)\b/,
  /\bme interesa (contratarlo|hacerlo|iniciar|proceder)\b/,
  /\bsi[, ]+(quiero|adelante|procedamos|iniciemos|empecemos)\b/,
  /\bquiero el plan (1|2|uno|dos)\b/,
  /\bme quedo con (el )?plan (1|2|uno|dos)\b/,
];

const PAUSE_PATTERNS = [
  /\b(lo voy a pensar|dejame pensarlo|déjame pensarlo|lo pienso|mas tarde|más tarde|despues|después)\b/,
  /\bpor ahora no\b/,
  /\bsolo estoy preguntando\b/,
  /\bsolo quiero informacion\b/,
];

const PRICE_OBJECTION_PATTERNS = [
  /\b(caro|muy caro|se me hace caro|esta caro|está caro|no me alcanza|no tengo ese dinero)\b/,
  /\b(hay algo mas barato|hay algo más barato|descuento|promocion|promoción)\b/,
];

const PLAN_2_SIGNALS = [
  /\bafore\b/,
  /\binfonavit\b/,
  /\bcredito (de )?vivienda\b/,
  /\bcredito infonavit\b/,
  /\bpuntos (de )?infonavit\b/,
];

const PLAN_1_SIGNALS = [
  /\bservicio medico\b/,
  /\bseguro medico\b/,
  /\bsemanas cotizadas\b/,
  /\bseguir cotizando\b/,
  /\bbeneficiarios?\b/,
  /\bguarderia\b/,
  /\bmaternidad\b/,
];

const INTEREST_PATTERNS = [
  /\bme interesa\b/,
  /\bsuena bien\b/,
  /\bme sirve\b/,
  /\bcreo que (si|sí)\b/,
  /\bquiero saber mas\b/,
  /\bquiero saber más\b/,
];

export const SALES_STAGES = Object.freeze([
  "exploring",
  "qualified",
  "plan_recommended",
  "explaining",
  "objection_handling",
  "interested",
  "authorized",
  "handoff",
]);

export function detectPlanPreference(text) {
  const value = norm(text);
  if (/\bplan\s*(2|dos)\b/.test(value)) return "plan_2";
  if (/\bplan\s*(1|uno)\b/.test(value)) return "plan_1";
  if (hasAny(value, PLAN_2_SIGNALS)) return "plan_2";
  if (hasAny(value, PLAN_1_SIGNALS)) return "plan_1";
  return null;
}

export function detectAuthorization(text) {
  const value = norm(text);
  if (!value || hasAny(value, PAUSE_PATTERNS)) return false;
  return hasAny(value, AUTHORIZATION_PATTERNS);
}

export function analyzeNextSale(text, memory = {}) {
  const value = norm(text);
  const previous = memory.sales_cycle || {};
  const plan = detectPlanPreference(value) || previous.recommended_plan || previous.selected_plan || null;
  const authorized = detectAuthorization(value);
  const priceObjection = hasAny(value, PRICE_OBJECTION_PATTERNS);
  const interest = authorized || hasAny(value, INTEREST_PATTERNS);

  let stage = previous.stage || "exploring";
  if (plan && ["exploring", "qualified"].includes(stage)) stage = "plan_recommended";
  if (plan && /\b(que incluye|beneficios|diferencia|como funciona|cómo funciona)\b/.test(value)) stage = "explaining";
  if (priceObjection) stage = "objection_handling";
  if (interest && !authorized) stage = "interested";
  if (authorized) stage = "authorized";

  const selectedPlan = authorized
    ? (detectPlanPreference(value) || previous.selected_plan || previous.recommended_plan || null)
    : (previous.selected_plan || null);

  const patch = {
    sales_cycle: {
      ...previous,
      stage,
      recommended_plan: plan || previous.recommended_plan || null,
      selected_plan: selectedPlan,
      interested: Boolean(previous.interested || interest),
      authorized: Boolean(previous.authorized || authorized),
      authorization_text: authorized ? String(text || "").trim() : previous.authorization_text || null,
      price_objection_count: Number(previous.price_objection_count || 0) + (priceObjection ? 1 : 0),
      last_signal_at: new Date().toISOString(),
    },
  };

  return {
    patch,
    stage,
    recommendedPlan: plan,
    authorized,
    priceObjection,
    interested: interest,
  };
}

export function commercialInstruction(memory = {}) {
  const cycle = memory.sales_cycle || {};
  const plan = cycle.selected_plan || cycle.recommended_plan;
  const planText = plan === "plan_2"
    ? "El plan recomendado es Plan 2 ($1,500 MXN)."
    : plan === "plan_1"
      ? "El plan recomendado es Plan 1 ($1,100 MXN)."
      : "Aún no hay plan recomendado.";

  return `ESTADO COMERCIAL NEXT:\n- etapa: ${cycle.stage || "exploring"}\n- ${planText}\n- interesado: ${Boolean(cycle.interested)}\n- autorizado: ${Boolean(cycle.authorized)}\nReglas: responde primero la duda explícita. Recomienda Plan 1 para servicio médico/semanas/beneficiarios y Plan 2 cuando también busca AFORE o INFONAVIT. No solicites CURP/NSS como objetivo de venta antes de autorización. No declares autorización por inferencia. Si autorizado=true, no sigas vendiendo ni hagas más preguntas: prepara handoff humano.`;
}

export function enforceAuthorizedHandoff(decision, memory = {}) {
  if (!memory.sales_cycle?.authorized) return decision;
  return {
    ...decision,
    handoff: true,
    handoff_reason: decision?.handoff_reason || "El cliente autorizó iniciar el trámite.",
    question_key: null,
  };
}
