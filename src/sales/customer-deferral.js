// Cuando el cliente pospone ("ahorita no tengo dinero", "yo le aviso") o cierra la
// plática ("no, todo bien, gracias"), Mia debe despedirse con amabilidad y dejar de
// insistir: no volver a ofrecer el plan, no pedir más datos y no programar seguimientos.

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// "cuanto" aparece seguido como error de dedo de "cuento" ("no cuánto con dinero").
const NO_MONEY_RE = [
  /\bno (?:cuento|cuanto|tengo|traigo|dispongo)(?: ahorita| ahora| por ahora)?(?: con)? (?:el |la |los )?(?:dinero|recurso|recursos|lana|varo|fondos|presupuesto|para pagar|para pagarlo|forma de pagar|forma de pago|como pagar)\b/,
  /\bno tengo (?:ahorita |ahora |por el momento )?(?:la |una )?(?:forma|manera|modo) de pagar\b/,
  /\b(?:ahorita|por el momento|por ahora|de momento|en este momento)\b.{0,40}\bno (?:puedo pagar|tengo (?:dinero|para)|cuento con|cuanto con|me alcanza)\b/,
  /\bestoy (?:corta|corto|sin dinero|sin lana)\b/,
];

const LATER_RE = [
  /\b(?:yo )?(?:le|les|los|las|te) (?:aviso|escribo|contacto|marco|busco|confirmo)\b/,
  /\bcuando (?:yo )?(?:pueda|tenga|junte|me paguen|cobre|lo tenga|tenga el dinero)\b/,
  /\b(?:mas adelante|despues (?:le|les|te) (?:escribo|aviso)|luego (?:le|les|te) (?:escribo|aviso)|otro dia)\b/,
  /\blo (?:voy a pensar|pienso|consulto|platico)\b/,
];

const THANKS_RE = /\b(?:gracias|grasias|graciaz|todo bien|igualmente|saludos|bendiciones|que amable)\b/;
const CLOSING_ONLY_RE = /^(?:(?:a|ah|ahh|oh|ok|okay|okey|si|no|vale|va|bueno|muy bien|todo bien|esta bien|perfecto|listo|de acuerdo|entendido|gracias|grasias|graciaz|muchas gracias|mil gracias|muchisimas gracias|que amable|igualmente|saludos|bendiciones|excelente|por la informacion|por todo)[ ,.!]*)+$/;

function asksSomething(text) {
  return /[?¿]/.test(String(text || "")) || /\b(?:cuanto|cuando abren|que documentos|cuales|como le hago|donde)\b/.test(norm(text)) && !/\bcuando (?:yo )?(?:pueda|tenga)\b/.test(norm(text));
}

// "no_money" | "later" | null
export function detectDeferral(text) {
  const value = norm(text);
  if (!value || /[?¿]/.test(String(text))) return null;
  if (NO_MONEY_RE.some(re => re.test(value))) return "no_money";
  if (LATER_RE.some(re => re.test(value))) return "later";
  return null;
}

// Mensaje que solo agradece o confirma que no tiene dudas ("No, todo bien. Gracias").
export function detectClosing(text) {
  const value = norm(text);
  if (!value || asksSomething(text)) return false;
  return THANKS_RE.test(value) && CLOSING_ONLY_RE.test(value);
}

const CLOSING_MARK = "escríbeme por aquí";

function firstName(memory = {}) {
  const raw = String(memory.nombre || "").trim().split(/\s+/)[0] || "";
  if (!raw || raw.length < 2) return "";
  return `, ${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
}

function planLabel(memory = {}) {
  const plan = memory.sales_cycle?.selected_plan || memory.sales_cycle?.recommended_plan;
  return plan === "plan_2" ? "el Plan 2" : plan === "plan_1" ? "el Plan 1" : null;
}

export function deferralDecision(memory = {}, combinedText = "") {
  const kind = detectDeferral(combinedText);
  const closing = !kind && detectClosing(combinedText);
  if (!kind && !closing) return null;
  const name = firstName(memory);
  const plan = planLabel(memory);
  const alreadyClosed = String(memory.ultima_respuesta_agente || "").includes(CLOSING_MARK);
  let reply;
  if (kind === "no_money") reply = `Entiendo${name}, no te preocupes. Cuando tengas la posibilidad, ${CLOSING_MARK} y con gusto retomamos tu trámite${plan ? ` con ${plan}` : ""}. Aquí estaré para ayudarte.`;
  else if (kind === "later") reply = alreadyClosed ? "" : `Claro${name}, sin problema. Cuando lo decidas, ${CLOSING_MARK} y con gusto retomamos tu trámite. Aquí estaré para ayudarte.`;
  // Un "gracias" después de que Mia ya se despidió no necesita otra respuesta.
  else reply = alreadyClosed ? "" : `Con gusto${name}. Quedo al pendiente; cuando quieras continuar, ${CLOSING_MARK}.`;
  return {
    reply,
    question_key: null,
    add_labels: [], remove_labels: [], handoff: false, handoff_reason: "",
    deferral: kind || "closing",
  };
}
