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
  /\bquiero (contratar|iniciar|hacerlo|proceder|continuar|darme de alta|dar de alta|empezar)(?:\b|\s+(?:el )?(?:tramite|proceso|alta))/,
  /\badelante con (el )?(tramite|proceso|alta)\b/,
  /\b(iniciemos|empecemos|procedamos)(?:\s+(?:con )?(?:el )?(?:tramite|proceso|alta))?\b/,
  /\bme interesa (contratarlo|hacerlo|iniciar|proceder)\b/,
  /\bsi[, ]+(quiero (?:iniciar|proceder|continuar|empezar)|adelante con (?:el )?(?:tramite|proceso|alta)|procedamos|iniciemos|empecemos)\b/,
];

const PLAN_SELECTION_PATTERNS = [
  { plan: "plan_2", pattern: /\b(quiero|prefiero|elijo|me quedo con|me interesa)(?:\s+el)?\s+plan\s*(2|dos)\b/ },
  { plan: "plan_1", pattern: /\b(quiero|prefiero|elijo|me quedo con|me interesa)(?:\s+el)?\s+plan\s*(1|uno)\b/ },
];

const PAUSE_PATTERNS = [
  /\b(lo voy a pensar|dejame pensarlo|lo pienso|mas tarde|despues)\b/,
  /\bpor ahora no\b/,
  /\bsolo estoy preguntando\b/,
  /\bsolo quiero informacion\b/,
];

const PRICE_OBJECTION_PATTERNS = [
  /\b(caro|muy caro|se me hace caro|esta caro|no me alcanza|no tengo ese dinero)\b/,
  /\b(hay algo mas barato|descuento|promocion)\b/,
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
  /\bcreo que si\b/,
  /\bquiero saber mas\b/,
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

export function detectExplicitPlanSelection(text) {
  const value = norm(text);
  const match = PLAN_SELECTION_PATTERNS.find(item => item.pattern.test(value));
  return match?.plan || null;
}

export function detectPlanPreference(text) {
  const value = norm(text);
  const explicitSelection = detectExplicitPlanSelection(value);
  if (explicitSelection) return explicitSelection;

  const mentionsPlan1 = /\bplan\s*(1|uno)\b/.test(value);
  const mentionsPlan2 = /\bplan\s*(2|dos)\b/.test(value);
  if (mentionsPlan1 && mentionsPlan2) return null;

  const rejectsPlan2Need = /\b(no|sin)\b.{0,30}\b(afore|infonavit|credito|puntos)\b/.test(value)
    || /\b(afore|infonavit)\b.{0,30}\b(no me interesa|no quiero|no necesito)\b/.test(value);

  if (!rejectsPlan2Need && hasAny(value, PLAN_2_SIGNALS)) return "plan_2";
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
  const detectedPlan = detectPlanPreference(value);
  const explicitSelection = detectExplicitPlanSelection(value);
  const plan = detectedPlan || previous.recommended_plan || previous.selected_plan || null;
  const authorized = detectAuthorization(value);
  const priceObjection = hasAny(value, PRICE_OBJECTION_PATTERNS);
  const interest = authorized || Boolean(explicitSelection) || hasAny(value, INTEREST_PATTERNS);

  let stage = previous.stage || "exploring";
  if (detectedPlan && ["exploring", "qualified"].includes(stage)) stage = "plan_recommended";
  if (/\b(que incluye|beneficios|diferencia|como funciona)\b/.test(value)) stage = "explaining";
  if (priceObjection) stage = "objection_handling";
  if (interest && !authorized) stage = "interested";
  if (authorized) stage = "authorized";

  const selectedPlan = explicitSelection
    || previous.selected_plan
    || (authorized ? previous.recommended_plan || detectedPlan || null : null);

  const patch = {
    sales_cycle: {
      ...previous,
      stage,
      recommended_plan: detectedPlan || previous.recommended_plan || null,
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
    selectedPlan,
    authorized,
    priceObjection,
    interested: interest,
  };
}

export function commercialInstruction(memory = {}) {
  const cycle = memory.sales_cycle || {};
  const plan = cycle.selected_plan || cycle.recommended_plan;
  const planText = plan === "plan_2"
    ? "El plan seleccionado/recomendado es Plan 2 ($1,500 MXN)."
    : plan === "plan_1"
      ? "El plan seleccionado/recomendado es Plan 1 ($1,100 MXN)."
      : "Aún no hay plan recomendado.";

  return `ESTADO COMERCIAL NEXT:\n- etapa: ${cycle.stage || "exploring"}\n- ${planText}\n- interesado: ${Boolean(cycle.interested)}\n- autorizado: ${Boolean(cycle.authorized)}\nReglas: responde primero la duda explícita. Recomienda Plan 1 para servicio médico/semanas/beneficiarios y Plan 2 cuando también busca AFORE o INFONAVIT. Elegir o preguntar por un plan NO equivale a autorizar el trámite. No solicites CURP/NSS como objetivo de venta antes de autorización. No declares autorización por inferencia. Solo considera autorización cuando el cliente expresa claramente que desea iniciar/proceder con el trámite. Si autorizado=true, no sigas vendiendo ni hagas más preguntas: prepara handoff humano.`;
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
