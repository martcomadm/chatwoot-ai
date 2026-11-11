import { templateByName } from "../chatwoot/template-catalog.js";
// Reactivación de prospectos con plantillas aprobadas (pedido 5-nov).
// A quien no compró y dejó de escribir se le manda, fuera de la ventana de 24 h:
//   paso 1 · día 2  → seguimiento4        ("¿ha tenido alguna duda…?"; 6-nov, antes seguimiento3)
//   paso 2 · día 7  → procesoafiliacion1  (lo sencillo del proceso)
//   paso 3 · día 30 → saludodia2          (último recordatorio suave)
// Si dijo cuándo retomaba ("en la quincena", "la próxima semana"), el paso 1 va ese día.
// A quien ya aceptó pero no mandó documentos: recordatorio1 una vez (y luego Mia pide la INE).
// Nunca a quien no le interesa, se equivocó, ya compró, está con una persona o pidió no recibir mensajes.

export const REACTIVATION_STEPS = Object.freeze([
  { step: 1, template: "seguimiento4", afterDays: 2 },
  { step: 2, template: "procesoafiliacion1", afterDays: 7, minGapDays: 3 },
  { step: 3, template: "saludodia2", afterDays: 30, minGapDays: 7 },
]);
export const DOCS_REMINDER_TEMPLATE = "recordatorio1";
export const MAX_SILENCE_DAYS = 45;
const NO_CONTACT_DEFERRALS = new Set(["declined", "mistake", "not_fit"]);
const DAY = 24 * 3600 * 1000;

const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// "No me escriban", "ya no me manden mensajes", "dejen de escribirme", "baja" (de los mensajes).
export function asksNoContact(text = "") {
  const v = norm(text);
  return /\b(?:no|ya no)\s+me\s+(?:escriban|escribas|manden|mandes|envien|envies|molesten|molestes|contacten|contactes)\b|\bdejen de (?:escribirme|mandarme|molestarme|enviarme)\b|\b(?:no quiero|ya no quiero) (?:recibir|que me (?:escriban|manden))\b|^\s*(?:stop|alto|basta)\s*[.!]*\s*$/.test(v);
}

const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

// Fecha (YYYY-MM-DD, calendario de México) en que el cliente dijo que retomaba, o null.
export function resumeDate(text = "", fromIso = new Date().toISOString()) {
  const v = norm(text);
  const from = new Date(Date.parse(fromIso) - 6 * 3600 * 1000); // hora de México (sin horario de verano)
  const ymd = d => d.toISOString().slice(0, 10);
  const plus = n => new Date(from.getTime() + n * DAY);
  const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0));
  const y = from.getUTCFullYear(), m = from.getUTCMonth(), d = from.getUTCDate();
  if (/\bquincena\b/.test(v)) {
    if (d < 15) return ymd(new Date(Date.UTC(y, m, 15)));
    const end = lastDay(y, m);
    return d < end.getUTCDate() ? ymd(end) : ymd(new Date(Date.UTC(y, m + 1, 15)));
  }
  if (/\bfin(?:al)? de mes\b|\bfinales de mes\b/.test(v)) { const end = lastDay(y, m); return d < end.getUTCDate() - 1 ? ymd(end) : ymd(lastDay(y, m + 1)); }
  const dated = v.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (dated) {
    let target = new Date(Date.UTC(y, MONTHS[dated[2]], Number(dated[1])));
    if (target.getTime() <= from.getTime()) target = new Date(Date.UTC(y + 1, MONTHS[dated[2]], Number(dated[1])));
    return ymd(target);
  }
  if (/\b(?:proximo|siguiente|otro)\s+mes\b|\bmes que (?:viene|entra)\b/.test(v)) return ymd(new Date(Date.UTC(y, m + 1, 1)));
  if (/\b(?:proxima|siguiente|otra)\s+semana\b|\bsemana que (?:viene|entra)\b/.test(v)) return ymd(plus(7));
  const inDays = v.match(/\b(?:en|dentro de)\s+(\d{1,2}|dos|tres|cuatro|cinco|ocho|quince)\s+dias\b/);
  if (inDays) { const n = { dos: 2, tres: 3, cuatro: 4, cinco: 5, ocho: 8, quince: 15 }[inDays[1]] ?? Number(inDays[1]); if (n > 0 && n <= 60) return ymd(plus(n)); }
  const weekday = v.match(/\b(?:el|este|el proximo|proximo)\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (weekday) { const target = WEEKDAYS[weekday[1]]; let n = (target - from.getUTCDay() + 7) % 7; if (n === 0) n = 7; return ymd(plus(n)); }
  if (/\bpasado manana\b/.test(v)) return ymd(plus(2));
  if (/\bmanana\b/.test(v)) return ymd(plus(1));
  return null;
}

// Por qué no se le escribe (o null si sí corresponde).
export function skipReason(memory = {}) {
  const c = memory.sales_cycle || {};
  if (memory.no_contact) return "no_contact";
  if (memory.mia_omitted?.active) return "omitted";
  if (NO_CONTACT_DEFERRALS.has(String(c.deferral || ""))) return "not_interested";
  if (memory.capture_intervention?.active) return "intervened";
  if (memory.service_sale?.active) return "service_sale";
  if (memory.handoff?.status && !["completed", "returned"].includes(String(memory.handoff.status))) return "human";
  return null;
}

// Qué mandar hoy. lastCustomerAt = último mensaje del cliente. Devuelve { kind, template, step?, reason } o null.
export function nextReactivation(memory = {}, { lastCustomerAt, now = new Date() } = {}) {
  if (skipReason(memory)) return null;
  const last = Date.parse(lastCustomerAt || "");
  if (!Number.isFinite(last)) return null;
  // Chat con etiqueta de cierre o en pausa (9-nov: al cliente que contestó la plantilla Mia ya no le respondió).
  // Se revisa al enviar (reactivation-service); hasta que el cliente vuelva a escribir no se intenta otra vez.
  if (Date.parse(memory.reactivation?.blocked_at || "") > last) return null;
  const silentDays = (now.getTime() - last) / DAY;
  if (silentDays > MAX_SILENCE_DAYS) return null;
  const state = memory.reactivation || {};
  const sent = Array.isArray(state.sent) ? state.sent : [];
  const c = memory.sales_cycle || {};
  // Ya aceptó: solo el recordatorio de documentos, una vez, entre 1 y 7 días de silencio.
  if (c.authorized) {
    if (memory.operations?.documents_complete || state.docs_reminder_at) return null;
    if (silentDays < 1 || silentDays > 7) return null;
    return { kind: "documents", template: DOCS_REMINDER_TEMPLATE, reason: "aceptó y no ha mandado documentos" };
  }
  // La plantilla de 24 h del seguimiento es la misma del día 2 (seguimiento4): si ya salió después de su último
  // mensaje, cuenta como el paso 1 y no se le manda dos veces el mismo texto (6-nov).
  const reengageAt = Date.parse(memory.reengage_template_at || "");
  const step1 = REACTIVATION_STEPS[0];
  const steps = Number.isFinite(reengageAt) && reengageAt > last && !sent.some(x => x.step === 1 || x.template === step1.template)
    ? [{ step: 1, template: step1.template, at: memory.reengage_template_at, via: "followup_24h" }, ...sent]
    : sent;
  const nextStep = REACTIVATION_STEPS[steps.length];
  if (!nextStep) return null;
  const lastSentAt = Date.parse(steps.at(-1)?.at || "") || 0;
  if (lastSentAt && (now.getTime() - lastSentAt) / DAY < (nextStep.minGapDays || 0)) return null;
  // Lo que se mandó antes de que el cliente volviera a escribir no cuenta para esperar: se mide desde su último mensaje.
  if (nextStep.step === 1) {
    const resume = c.deferral_resume_date || null;
    if (resume) {
      const today = new Date(now.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
      if (today < resume) return null;
      if (silentDays >= 1) return { kind: "reactivation", ...nextStep, reason: `dijo que retomaba el ${resume}` };
      return null;
    }
  }
  if (silentDays < nextStep.afterDays) return null;
  return { kind: "reactivation", ...nextStep, reason: `${Math.floor(silentDays)} días sin escribir` };
}

// Respuesta de Mia cuando el cliente contesta a una plantilla de reactivación con un "sí" / "me interesa".
const YES_RE = /^(?:si+|sip|claro|ok|okay|va|vale|sale|me interesa|si me interesa|aun me interesa|todavia me interesa|si todavia|si aun|por favor|de acuerdo|bueno|adelante|hola|buen dia|buenos dias|buenas tardes|gracias)\b/;
export function reactivationReplyDecision(memory = {}, text = "") {
  const state = memory.reactivation || {};
  // La plantilla de 24 h del seguimiento también es seguimiento4 y no queda en memory.reactivation (9-nov).
  const followUpTemplate = String(memory.ultima_respuesta_agente || "") === (templateByName("seguimiento4")?.text || "-");
  const lastName = state.awaiting_reply ? state.sent?.at(-1)?.template : followUpTemplate ? "seguimiento4" : null;
  if (!lastName) return null;
  const c0 = memory.sales_cycle || {};
  const plan0 = c0.selected_plan || c0.recommended_plan || (c0.explained_plans || []).at(-1) || (c0.pitched_plans || []).at(-1) || null;
  // "❓❔", "¿quién es?", "¿de dónde o qué es martcom?" (9-nov): no recuerda la plática. Se le recuerda quién
  // le escribe y por qué.
  const raw = String(text || "").trim();
  if (/^[\s?¿❓❔!]+$/.test(raw) || /^(?:hola\s+|buen(?:os)? dias?\s+|disculpe\s+)*(?:quien (?:es|eres|habla|me escribe)|de donde (?:me escribe|es|son)|quienes son|que es esto|de que es|no se quien es|perdon quien es)\b/.test(norm(raw)) || /\b(?:que|quien|quienes) (?:es|son) martcom\b|\bde donde o que es\b/.test(norm(raw))) {
    const planName = plan0 === "plan_2" ? "el Plan 2" : plan0 === "plan_1" ? "el Plan 1" : null;
    return { reply: `¡Hola! Soy Mia, la asistente virtual de MARTCOM. Somos una consultoría que te ayuda a darte de alta ante el IMSS para que tengas servicio médico y sigas sumando semanas. Hace unos días platicamos sobre tu afiliación${planName ? ` y ${planName}` : ""}, y te escribí para saber si te quedó alguna duda. ¿Quieres que te explique cómo funciona ${planName || "el Plan 1"}?`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", plan: plan0 };
  }
  const v = norm(text).replace(/[!.,]+$/g, "");
  if (!v || v.length > 60 || /[?¿]/.test(text) || !YES_RE.test(v) || /\bno\b/.test(v)) return null;
  const c = memory.sales_cycle || {};
  const plan = c.selected_plan || c.recommended_plan || (c.explained_plans || []).at(-1) || (c.pitched_plans || []).at(-1) || null;
  // seguimiento4 pregunta "¿Ha tenido alguna duda…?": "Sí" es que tiene una duda.
  // Solo un "sí" pelón; "Sí me interesa" (10-nov: recibió "cuéntame cuál es tu duda") es interés, no una duda,
  // y un saludo solo ("Buenos días") lo contesta el flujo normal.
  const interested = /\b(?:interesa|quiero|iniciar|empezar|afiliarme|continuar|adelante)\b/.test(v);
  if (lastName === "seguimiento4" && /^(?:hola|buen dia|buenos dias|buenas tardes|gracias)(?: (?:hola|buen dia|buenos dias|buenas tardes|gracias))*$/.test(v)) return null;
  if (lastName === "seguimiento4" && !interested) {
    const recap = plan === "plan_2" ? " Te recuerdo que el Plan 2 cuesta $1,500 MXN mensuales e incluye servicio médico del IMSS, semanas cotizadas y aportaciones a tu AFORE e INFONAVIT."
      : plan === "plan_1" ? " Te recuerdo que el Plan 1 cuesta $1,100 MXN mensuales e incluye servicio médico del IMSS y semanas cotizadas." : "";
    return { reply: `Con gusto te ayudo, cuéntame cuál es tu duda.${recap}${recap ? " El primer pago se hace hasta que tu alta ya está vigente." : ""}`, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", plan };
  }
  const reply = plan === "plan_2"
    ? "¡Qué gusto! Te recuerdo: el Plan 2 cuesta $1,500 MXN mensuales e incluye servicio médico del IMSS, semanas cotizadas y aportaciones a tu AFORE e INFONAVIT. El primer pago se hace hasta que tu alta ya está vigente. ¿Quieres que iniciemos tu trámite?"
    : plan === "plan_1"
      ? "¡Qué gusto! Te recuerdo: el Plan 1 cuesta $1,100 MXN mensuales e incluye servicio médico del IMSS y semanas cotizadas. El primer pago se hace hasta que tu alta ya está vigente. ¿Quieres que iniciemos tu trámite?"
      : "¡Qué gusto! Para darte la información correcta, ¿qué te interesa más? Responde con el número:\n1️⃣ Servicio médico del IMSS\n2️⃣ Seguir sumando semanas para mi pensión\n3️⃣ Todo lo anterior y además AFORE e INFONAVIT";
  return { reply, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", plan };
}
