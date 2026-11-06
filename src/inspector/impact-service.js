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
  return {
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
  };
}

export function buildImpact({ memories = [], eventsByConv = new Map(), feedback = [], timezone = "America/Mexico_City", since = DEFAULT_CHANGE_DATE, to = null, now = new Date() } = {}) {
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
    return { key, label: ENTRY_LABELS[key] || key, before: { nuevas: a.length, aceptaron: a.filter(f => f.authorized).length, conversion: pct(a.filter(f => f.authorized).length, a.length) }, after: { nuevas: b.length, aceptaron: b.filter(f => f.authorized).length, conversion: pct(b.filter(f => f.authorized).length, b.length) } };
  }).sort((x, y) => (y.after.nuevas + y.before.nuevas) - (x.after.nuevas + x.before.nuevas));
  const rated = r => {
    const list = feedback.filter(item => { const d = localDate(item.at, timezone); return d >= r.from && d <= r.to; });
    const up = list.filter(i => i.rating === "up").length, down = list.filter(i => i.rating === "down").length;
    return { up, down, approval: pct(up, up + down) };
  };
  const partialDay = to === today;
  return {
    generated_at: now.toISOString(),
    since, days: span, partial_day: partialDay,
    before: { ...before, ...summarize(A), ratings: rated(before) },
    after: { ...afterR, ...summarize(B), ratings: rated(afterR) },
    entries,
    note: span < 7 ? "Todavía hay pocos días después del cambio: la comparación se vuelve confiable con 7 días o más." : null,
  };
}
