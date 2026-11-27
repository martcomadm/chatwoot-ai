// Tablero de impacto (pedido 5-nov): ¿funcionan las mejoras del 2 al 4-nov?
// Compara un periodo "después del cambio" contra uno "antes" del mismo largo, y mide cada
// herramienta nueva: diagnóstico del caso, menú numerado, oferta de llamada, avisos a Captura,
// intervenciones (ventas salvadas), respuestas del equipo y calificaciones 👍/👎.
import { entryOf, ENTRY_LABELS } from "./stats-service.js";

const DAY = 24 * 3600 * 1000;
const ms = iso => Date.parse(iso || "") || 0;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const CALL_OFFER = "prefieres que un asesor te llame";
const MENU_MARK = "responde con el numero";
const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const DEFAULT_CHANGE_DATE = "2026-11-05";

function localDate(iso, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY) + 1; }

// Hechos de una conversación para el tablero.
function facts(id, events, memory = {}) {
  const firstCustomer = events.find(e => e.details?.customer_text)?.details?.customer_text || "";
  const at = (pred) => events.find(pred)?.timestamp || null;
  const all = (pred) => events.filter(pred);
  const authorizedAt = at(e => e.type === "authorized_sale_workflow") || (memory.sales_cycle?.authorized ? memory.sales_cycle?.authorized_at || null : null);
  const docsAt = at(e => ["authorized_sale_workflow", "operations_sale_ready"].includes(e.type) && e.details?.documents_complete === true);
  const after = (iso) => (t) => Boolean(t) && ms(t) >= ms(iso);
  const diagnosis = at(e => e.type === "ai_reply_sent" && /^case_diagnosis:(?!reprompt)/.test(String(e.details?.decision_source || "")));
  const menuSent = at(e => e.type === "followup_sent" && norm(e.details?.text).includes(MENU_MARK));
  const menuChoice = at(e => e.type === "need_menu_choice");
  const callOffer = at(e => e.type === "followup_sent" && norm(e.details?.text).includes(CALL_OFFER));
  const callAccepted = at(e => e.type === "handoff" && /acept[oó] que un asesor le llame/i.test(String(e.details?.reason || "")));
  const alerts = all(e => e.type === "cold_lead_alert");
  const intervention = at(e => e.type === "capture_intervention");
  // 11-nov: ¿cuánto tarda el equipo en tomar cada aviso? Atendido = alguien intervino el chat en las 24 h siguientes.
  const interventions = all(e => e.type === "capture_intervention");
  const alertResponses = all(e => e.type === "hot_lead_alert" || (e.type === "cold_lead_alert" && (e.details?.kind || "cold_lead") === "cold_lead")).map(a => {
    const taken = interventions.find(i => ms(i.timestamp) >= ms(a.timestamp) && ms(i.timestamp) - ms(a.timestamp) <= DAY);
    return { kind: a.type === "hot_lead_alert" ? "hot" : "cold", at: a.timestamp, by: taken?.details?.by || null, minutes: taken ? Math.round((ms(taken.timestamp) - ms(a.timestamp)) / 60000) : null };
  });
  const customerTurns = new Set(events.filter(e => e.type === "ai_reply_sent" && e.details?.customer_text).map(e => norm(e.details.customer_text))).size;
  return {
    alertResponses, replied: customerTurns >= 2,
    id,
    first_at: events[0]?.timestamp || memory.actualizado_en || null,
    entry: entryOf(firstCustomer),
    authorized: Boolean(authorizedAt || memory.sales_cycle?.authorized),
    authorized_at: authorizedAt,
    docs: Boolean(docsAt || memory.operations?.documents_complete),
    diagnosis, menuSent, menuChoice, callOffer, callAccepted,
    alertLead: alerts.find(e => (e.details?.kind || "cold_lead") === "cold_lead")?.timestamp || null,
    alertDocs: alerts.find(e => e.details?.kind === "missing_docs")?.timestamp || null,
    intervention,
    // Salvada: no había aceptado al intervenir y aceptó después.
    saved: Boolean(intervention) && Boolean(authorizedAt) && after(intervention)(authorizedAt),
    saved_docs: Boolean(intervention) && Boolean(docsAt) && after(intervention)(docsAt),
    team_answers: all(e => e.type === "ai_reply_sent" && String(e.details?.decision_source || "").startsWith("team_answer:")).length,
    // 9-nov: modelo avanzado, aviso de cliente listo, llamada tras dos objeciones, aceptó con fecha.
    strong: at(e => e.type === "ai_reply_sent" && e.details?.model_tier === "strong"),
    strong_replies: all(e => e.type === "ai_reply_sent" && e.details?.model_tier === "strong").map(e => e.details?.hard_turn || "corrección o repetición"),
    hotLead: at(e => e.type === "hot_lead_alert"),
    earlyCall: at(e => e.type === "early_call_offer"),
    scheduledStart: at(e => e.type === "scheduled_start"),
  };
}

function summarize(list) {
  const n = list.length;
  const accepted = list.filter(f => f.authorized).length;
  const docs = list.filter(f => f.docs).length;
  const tool = (sentKey, extra = f => f.authorized) => {
    const sent = list.filter(f => f[sentKey]);
    return { sent: sent.length, accepted: sent.filter(extra).length, accepted_pct: pct(sent.filter(extra).length, sent.length) };
  };
  return {
    nuevas: n,
    aceptaron: accepted,
    conversion: pct(accepted, n),
    documentos: docs,
    docs_pct: pct(docs, accepted),
    diagnosis: tool("diagnosis"),
    menu: { ...tool("menuSent"), answered: list.filter(f => f.menuSent && f.menuChoice).length, answered_pct: pct(list.filter(f => f.menuSent && f.menuChoice).length, list.filter(f => f.menuSent).length) },
    call: { ...tool("callOffer"), took: list.filter(f => f.callOffer && f.callAccepted).length, took_pct: pct(list.filter(f => f.callOffer && f.callAccepted).length, list.filter(f => f.callOffer).length) },
    alert_lead: tool("alertLead"),
    alert_docs: tool("alertDocs", f => f.docs),
    intervened: { sent: list.filter(f => f.intervention).length, saved: list.filter(f => f.saved).length, saved_docs: list.filter(f => f.saved_docs).length, saved_pct: pct(list.filter(f => f.saved).length, list.filter(f => f.intervention).length) },
    team_answers: list.reduce((sum, f) => sum + f.team_answers, 0),
    strong: { ...tool("strong"), replies: list.reduce((sum, f) => sum + f.strong_replies.length, 0), reasons: Object.entries(list.flatMap(f => f.strong_replies).reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4) },
    hot_lead: tool("hotLead"),
    early_call: tool("earlyCall"),
    scheduled_start: { sent: list.filter(f => f.scheduledStart).length },
    response: responseSummary(list),
  };
}

const median = values => { const v = [...values].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2)) : null; };

// Tiempo de respuesta del equipo a los avisos (11-nov). Del 5 al 10-nov: 65 avisos y solo 16 intervenciones.
export function responseSummary(list) {
  const kindSummary = kind => {
    const alerts = list.flatMap(f => f.alertResponses.filter(a => a.kind === kind).map(a => ({ ...a, f })));
    const taken = alerts.filter(a => a.minutes !== null);
    return { alerts: alerts.length, taken: taken.length, taken_pct: pct(taken.length, alerts.length), within_15: taken.filter(a => a.minutes <= 15).length, median_minutes: median(taken.map(a => a.minutes)), untaken: alerts.length - taken.length };
  };
  const people = new Map();
  for (const f of list) for (const a of f.alertResponses) {
    if (a.minutes === null) continue;
    const p = people.get(a.by || "Sin nombre") || { name: a.by || "Sin nombre", taken: 0, minutes: [], chats: new Set(), saved: new Set() };
    p.taken++; p.minutes.push(a.minutes); p.chats.add(f.id); if (f.saved) p.saved.add(f.id);
    people.set(p.name, p);
  }
  return {
    hot: kindSummary("hot"), cold: kindSummary("cold"),
    people: [...people.values()].map(p => ({ name: p.name, taken: p.taken, within_15: p.minutes.filter(m => m <= 15).length, median_minutes: median(p.minutes), saved: p.saved.size })).sort((a, b) => b.taken - a.taken),
  };
}

// Embudo después del "sí" (11-nov): de los expedientes abiertos en el periodo, hasta dónde llegó cada uno.
export function afterYesFunnel(sales = []) {
  const n = sales.length;
  const step = (label, pred) => { const count = sales.filter(pred).length; return { label, count, pct: pct(count, n) }; };
  const cancelled = s => ["cancelled", "validation_rejected"].includes(s.status);
  const stuck = {};
  const QUEUE = { capture: "En Captura", validation: "En Validación", validity: "En Vigencia", payment: "En Cobranza" };
  for (const s of sales) {
    if (s.status === "completed" || cancelled(s) || s.status === "dropped_nonpayment") continue;
    const key = s.queue === "capture" && s.capture?.scheduled?.date ? "En Captura (alta agendada)" : s.queue === "capture" && !s.documents?.complete ? "En Captura (faltan documentos)" : QUEUE[s.queue] || "Otro";
    stuck[key] = (stuck[key] || 0) + 1;
  }
  const paid = s => Boolean(s.payment?.received || s.payment?.validated || s.status === "completed");
  return {
    total: n,
    steps: [
      step("Aceptaron iniciar (expediente abierto)", () => true),
      step("Documentos completos", s => Boolean(s.documents?.complete || s.capture?.completed_at)),
      step("Alta capturada", s => Boolean(s.capture?.completed_at)),
      step("Vigencia confirmada", s => Boolean(s.validity?.confirmed)),
      step("Pago solicitado", s => Boolean(s.payment?.requested)),
      step("Pagaron", paid),
    ],
    cancelled: sales.filter(cancelled).length,
    stuck: Object.entries(stuck).sort((a, b) => b[1] - a[1]),
    revenue: sales.filter(paid).reduce((sum, s) => sum + (Number(s.payment?.amount) || 0), 0),
  };
}

export function buildImpact({ memories = [], eventsByConv = new Map(), feedback = [], sales = [], timezone = "America/Mexico_City", since = DEFAULT_CHANGE_DATE, to = null, now = new Date() } = {}) {
  const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const today = localDate(now.toISOString(), timezone);
  if (!valid(since)) since = DEFAULT_CHANGE_DATE;
  if (!valid(to) || to < since) to = today;
  const span = daysBetween(since, to);
  const before = { from: addDays(since, -span), to: addDays(since, -1) };
  const afterR = { from: since, to };
  const memoryById = new Map(memories.map(m => [Number(m.id), m]));
  const all = [...eventsByConv].map(([id, events]) => facts(Number(id), events, memoryById.get(Number(id))));
  const inR = r => f => { if (!f.first_at) return false; const d = localDate(f.first_at, timezone); return d >= r.from && d <= r.to; };
  const A = all.filter(inR(before));
  const B = all.filter(inR(afterR));
  const entries = [...new Set([...A, ...B].map(f => f.entry))].map(key => {
    const a = A.filter(f => f.entry === key), b = B.filter(f => f.entry === key);
    return { key, label: ENTRY_LABELS[key] || key, replied_before: pct(a.filter(f => f.replied).length, a.length), replied_after: pct(b.filter(f => f.replied).length, b.length), before: { nuevas: a.length, aceptaron: a.filter(f => f.authorized).length, conversion: pct(a.filter(f => f.authorized).length, a.length) }, after: { nuevas: b.length, aceptaron: b.filter(f => f.authorized).length, conversion: pct(b.filter(f => f.authorized).length, b.length) } };
  }).sort((x, y) => (y.after.nuevas + y.before.nuevas) - (x.after.nuevas + x.before.nuevas));
  const rated = r => {
    const list = feedback.filter(item => { const d = localDate(item.at, timezone); return d >= r.from && d <= r.to; });
    const up = list.filter(i => i.rating === "up").length, down = list.filter(i => i.rating === "down").length;
    return { up, down, approval: pct(up, up + down) };
  };
  const partialDay = to === today;
  const inSale = r => s => { if (!s?.created_at) return false; const d = localDate(s.created_at, timezone); return d >= r.from && d <= r.to; };
  return {
    generated_at: now.toISOString(),
    since, days: span, partial_day: partialDay,
    before: { ...before, ...summarize(A), ratings: rated(before), funnel: afterYesFunnel(sales.filter(inSale(before))) },
    after: { ...afterR, ...summarize(B), ratings: rated(afterR), funnel: afterYesFunnel(sales.filter(inSale(afterR))) },
    entries,
    note: span < 7 ? "Todavía hay pocos días después del cambio: la comparación se vuelve confiable con 7 días o más." : null,
  };
}
