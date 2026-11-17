// Estadísticas del Inspector de Mia (29-oct): tendencias por día, semana o mes, comparación entre
// periodos y desgloses (cómo llegaron, qué buscan, edad, plan, dónde se quedan, horas de más actividad).
//
// Todo sale de lo que ya se guarda: los eventos de cada conversación (respuestas de Mia, expedientes,
// seguimientos, pases a persona…), la memoria de cada conversación y los expedientes de Operations.
// Los chats de prueba no cuentan (ya vienen filtrados).

import { adOpeningKind } from "../sales/ad-openings.js";

const DAY = 86400000;
const PRICE = { plan_1: 1100, plan_2: 1500 };

// ── Métricas ──────────────────────────────────────────────────────────
// good: "up" si conviene que suba, "down" si conviene que baje.
export const METRICS = [
  { key: "nuevas", label: "Conversaciones nuevas", good: "up", group: "Mia" },
  { key: "atendidas", label: "Clientes atendidos por Mia", good: "up", group: "Mia" },
  { key: "aceptaron", label: "Aceptaron iniciar", good: "up", group: "Mia" },
  { key: "conversion", label: "Conversión (aceptaron / nuevas)", good: "up", unit: "%", group: "Mia" },
  { key: "documentos", label: "Expedientes con documentos completos", good: "up", group: "Mia" },
  { key: "a_persona", label: "Pasaron a una persona", good: null, group: "Mia" },
  { key: "pospusieron", label: "Pospusieron o dijeron que no", good: "down", group: "Mia" },
  { key: "no_contestaron", label: "No contestaron los seguimientos", good: "down", group: "Mia" },
  { key: "fuera_horario", label: "Escribieron fuera de horario", good: null, group: "Mia" },
  { key: "respuestas", label: "Respuestas de Mia", good: null, group: "Calidad" },
  { key: "pct_reglas", label: "Respuestas por reglas u oficiales", good: "up", unit: "%", group: "Calidad" },
  { key: "pct_genericas", label: "Respuestas genéricas", good: "down", unit: "%", group: "Calidad" },
  { key: "repetidas", label: "Respuestas repetidas", good: "down", group: "Calidad" },
  { key: "errores", label: "Errores", good: "down", group: "Calidad" },
  { key: "tiempo_respuesta", label: "Tiempo de respuesta (mediana)", good: "down", unit: "s", group: "Calidad" },
  { key: "seguimientos", label: "Seguimientos enviados", good: null, group: "Calidad" },
  { key: "expedientes", label: "Expedientes abiertos", good: "up", group: "Operations" },
  { key: "altas", label: "Altas vigentes", good: "up", group: "Operations" },
  { key: "pagadas", label: "Ventas pagadas", good: "up", group: "Operations" },
  { key: "ingreso", label: "Primer pago cobrado (estimado)", good: "up", unit: "$", group: "Operations" },
  { key: "cancelados", label: "Expedientes cancelados", good: "down", group: "Operations" },
  { key: "bajas", label: "Bajas por falta de pago", good: "down", group: "Operations" },
];

export const ENTRY_LABELS = {
  pension: "Anuncio: seguir sumando semanas",
  case_review: "Anuncio: revisar mi caso con NSS",
  no_imss: "Anuncio: comenzar mi afiliación",
  already_affiliated: "Anuncio: ya estoy afiliado",
  info: "Anuncio: quiero más información",
  call: "Anuncio: llamada con mi asesor",
  direct: "Escribió con su propio mensaje",
};

export const NEED_LABELS = { afore: "AFORE e INFONAVIT", weeks: "Semanas / pensión", medical: "Servicio médico", unknown: "Sin definir" };
const DEFERRAL_LABELS = { no_money: "Sin dinero por ahora", later: "Avisará después", closing: "Se despidió", declined: "No le interesa", not_fit: "No era lo que buscaba", mistake: "Se equivocó de número", start_later: "Iniciará después" };
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const ms = iso => Date.parse(iso || "") || 0;
const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// ── Fechas locales ───────────────────────────────────────────────────
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return value => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(value)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: wd[p.weekday] ?? 0 };
  };
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekdayOf = date => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
const mondayOf = date => addDays(date, -weekdayOf(date));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export function bucketKey(date, group) {
  if (group === "month") return date.slice(0, 7);
  if (group === "week") return mondayOf(date);
  return date;
}

export function bucketLabel(key, group) {
  if (group === "month") { const [y, m] = key.split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; }
  const d = (s) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
  if (group === "week") return `${d(key)} – ${d(addDays(key, 6))}`;
  return `${WEEKDAYS[weekdayOf(key)]} ${d(key)}`;
}

function bucketKeys(from, to, group) {
  const keys = [];
  if (group === "month") {
    let [y, m] = from.slice(0, 7).split("-").map(Number);
    const end = to.slice(0, 7);
    while (`${y}-${String(m).padStart(2, "0")}` <= end && keys.length < 60) { keys.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return keys;
  }
  const step = group === "week" ? 7 : 1;
  for (let d = group === "week" ? mondayOf(from) : from; d <= to && keys.length < 400; d = addDays(d, step)) keys.push(d);
  return keys;
}

// Rango por omisión según la agrupación: 30 días, 12 semanas o 6 meses hasta hoy.
export function defaultRange(group, today) {
  if (group === "month") { const [y, m] = today.slice(0, 7).split("-").map(Number); const start = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 10); return { from: start, to: today }; }
  if (group === "week") return { from: addDays(mondayOf(today), -77), to: today };
  return { from: addDays(today, -29), to: today };
}

// Periodo anterior del mismo largo (para meses: los mismos meses completos anteriores).
export function previousRange(from, to, group) {
  // "Este mes" o "mes pasado" (del día 1 a cualquier día del mismo mes): contra los mismos días del mes anterior.
  if (from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7)) {
    const [y, m] = from.slice(0, 7).split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const lastPrev = addDays(from, -1);
    const lastThis = addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
    const end = to === lastThis ? lastPrev : `${start.slice(0, 8)}${String(Math.min(Number(to.slice(8, 10)), Number(lastPrev.slice(8, 10)))).padStart(2, "0")}`;
    return { from: start, to: end };
  }
  if (group === "month") {
    const months = bucketKeys(from, to, "month").length;
    const [y, m] = from.slice(0, 7).split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
    const end = addDays(from.slice(0, 7) + "-01", -1);
    // Si el periodo actual va a medio mes, se compara contra los mismos días del mes anterior.
    const span = daysBetween(from, to);
    return months === 1 ? { from: start, to: addDays(start, Math.min(span, daysBetween(start, end))) } : { from: start, to: end };
  }
  const span = daysBetween(from, to) + 1;
  return { from: addDays(from, -span), to: addDays(from, -1) };
}

// ── Datos por conversación ───────────────────────────────────────────
export function entryOf(text) {
  const kind = adOpeningKind(text);
  if (kind) return kind;
  const v = norm(text);
  if (/^(?:¡?hola!?\s+)?quiero (?:mas )?informacion\b|^informacion$|^(?:me (?:puedes|podria|puede) dar )?mas informacion/.test(v)) return "info";
  if (/^quiero una llamada con mi asesor\b/.test(v)) return "call";
  return "direct";
}

export function needOf(memory = {}) {
  const n = memory.commercial_need || {};
  if (n.afore_infonavit) return "afore";
  if (n.weeks || n.retirement) return "weeks";
  if (n.service_medical) return "medical";
  return "unknown";
}

function ageGroup(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a < 15 || a > 100) return "Sin dato";
  if (a < 40) return "Menos de 40";
  if (a < 50) return "40 a 49";
  if (a < 60) return "50 a 59";
  return "60 o más";
}

const planOf = m => { const p = m?.sales_cycle?.selected_plan || m?.sales_cycle?.recommended_plan; return p === "plan_2" ? "Plan 2" : p === "plan_1" ? "Plan 1" : "Sin plan"; };

const PRICE_RE = /\$\s?1,?100|\$\s?1,?500/;
const CLOSE_RE = /inici(?:emos|amos|ar) (?:con )?tu tr[aá]mite|empezamos con tu tr[aá]mite|te ayudo a iniciar/i;

function conversationFacts(id, events, memory) {
  const replies = events.filter(e => e.type === "ai_reply_sent");
  const firstCustomer = events.find(e => e.details?.customer_text)?.details?.customer_text || "";
  const first = (types, extra = () => true) => events.find(e => types.includes(e.type) && extra(e))?.timestamp || null;
  const customerTurns = replies.filter(e => e.details?.customer_text);
  const authorizedAt = first(["authorized_sale_workflow"]);
  const followups = events.filter(e => e.type === "followup_sent").map(e => e.timestamp);
  const firstFollowup = followups[0] || null;
  return {
    customer_turns: customerTurns.length,
    turns_to_accept: authorizedAt ? customerTurns.filter(e => ms(e.timestamp) <= ms(authorizedAt)).length : null,
    price_at: replies.find(e => PRICE_RE.test(String(e.details?.reply || "")))?.timestamp || null,
    close_at: replies.find(e => CLOSE_RE.test(String(e.details?.reply || "")))?.timestamp || null,
    first_text: String(firstCustomer).split(/\n+/)[0].trim().slice(0, 140),
    tiene_imss: memory?.tiene_imss === true ? "si" : memory?.tiene_imss === false ? "no" : "sin_dato",
    experiments: Object.values(memory?.experiments || {}).filter(e => e && e.slot && e.variant).map(e => ({ slot: String(e.slot), variant: String(e.variant) })),
    followups,
    replied_after_followup: Boolean(firstFollowup && customerTurns.some(e => ms(e.timestamp) > ms(firstFollowup))),
    accepted_after_followup: Boolean(firstFollowup && authorizedAt && ms(authorizedAt) > ms(firstFollowup)),
    id,
    first_at: events[0]?.timestamp || memory?.actualizado_en || null,
    authorized_at: authorizedAt,
    documents_at: first(["authorized_sale_workflow", "operations_sale_ready"], e => e.details?.documents_complete === true),
    handoff_at: first(["handoff", "specialized_advice_handoff"]),
    entry: entryOf(firstCustomer),
    need: needOf(memory),
    age: ageGroup(memory?.edad),
    plan: planOf(memory),
    deferral: memory?.sales_cycle?.deferral || null,
    replies,
  };
}

// ── Cálculo ──────────────────────────────────────────────────────────
function emptyRow() {
  return { nuevas: 0, atendidas: new Set(), aceptaron: 0, documentos: 0, a_persona: 0, pospusieron: new Set(), no_contestaron: new Set(), fuera_horario: new Set(), respuestas: 0, reglas: 0, ia: 0, genericas: 0, repetidas: 0, errores: 0, tiempos: [], seguimientos: 0, expedientes: 0, altas: 0, pagadas: 0, ingreso: 0, cancelados: 0, bajas: 0 };
}

function finish(row) {
  return {
    nuevas: row.nuevas,
    atendidas: row.atendidas.size,
    aceptaron: row.aceptaron,
    conversion: pct(row.aceptaron, row.nuevas),
    documentos: row.documentos,
    a_persona: row.a_persona,
    pospusieron: row.pospusieron.size,
    no_contestaron: row.no_contestaron.size,
    fuera_horario: row.fuera_horario.size,
    respuestas: row.respuestas,
    pct_reglas: pct(row.reglas, row.respuestas),
    pct_genericas: pct(row.genericas, row.respuestas),
    repetidas: row.repetidas,
    errores: row.errores,
    tiempo_respuesta: median(row.tiempos),
    seguimientos: row.seguimientos,
    expedientes: row.expedientes,
    altas: row.altas,
    pagadas: row.pagadas,
    ingreso: row.ingreso,
    cancelados: row.cancelados,
    bajas: row.bajas,
  };
}

// Reparte cada hecho en su cubeta (o en la del total si `keyOf` regresa la misma llave).
function accumulate({ facts, eventsByConv, sales, local, keyOf }) {
  const rows = new Map();
  const row = key => { if (!rows.has(key)) rows.set(key, emptyRow()); return rows.get(key); };
  const at = iso => { if (!iso) return null; const k = keyOf(local(iso).date); return k; };

  for (const f of facts) {
    let k;
    if ((k = at(f.first_at))) row(k).nuevas++;
    if ((k = at(f.authorized_at))) row(k).aceptaron++;
    if ((k = at(f.documents_at))) row(k).documentos++;
    if ((k = at(f.handoff_at))) row(k).a_persona++;
    const seen = new Set();
    for (const e of f.replies) {
      const reply = norm(e.details?.reply);
      const repeated = reply && seen.has(reply);
      if (reply) seen.add(reply);
      if (!(k = at(e.timestamp))) continue;
      const r = row(k);
      r.respuestas++; r.atendidas.add(f.id);
      const src = String(e.details?.decision_source || "");
      if (src === "llm" || src === "llm_repair") r.ia++;
      else if (src.startsWith("fallback") || src === "quality_fallback") r.genericas++;
      else r.reglas++;
      if (repeated) r.repetidas++;
      if (/^customer_(?:deferral|closing)$/.test(src) || e.details?.commitment === "declined") r.pospusieron.add(f.id);
      const customerAt = ms(e.details?.customer_at);
      if (customerAt) { const secs = Math.round((ms(e.timestamp) - customerAt) / 1000); if (secs >= 0 && secs < 6 * 3600) r.tiempos.push(secs); }
    }
  }
  for (const [id, events] of eventsByConv) {
    for (const e of events) {
      if (!["followup_no_response", "ignored_out_of_schedule", "ai_error", "processing_error", "followup_sent"].includes(e.type)) continue;
      const k = at(e.timestamp);
      if (!k) continue;
      const r = row(k);
      if (e.type === "followup_no_response") r.no_contestaron.add(id);
      if (e.type === "ignored_out_of_schedule") r.fuera_horario.add(id);
      if (e.type === "ai_error" || e.type === "processing_error") r.errores++;
      if (e.type === "followup_sent") r.seguimientos++;
    }
  }
  for (const s of sales) {
    let k;
    if ((k = at(s.created_at))) row(k).expedientes++;
    if ((k = at(s.validity?.confirmed_at))) row(k).altas++;
    if ((k = at(s.payment?.validated_at))) { row(k).pagadas++; row(k).ingreso += PRICE[s.sale?.plan] || 0; }
    const cancelled = (s.events || []).filter(e => e.type === "supervision.cancelled").at(-1)?.at;
    if ((k = at(cancelled))) row(k).cancelados++;
    if ((k = at(s.debt?.dropped_at))) row(k).bajas++;
  }
  return rows;
}

function countBy(list, keyFn, labels = null) {
  const map = new Map();
  for (const item of list) { const k = keyFn(item); map.set(k, (map.get(k) || 0) + 1); }
  return [...map].map(([key, count]) => ({ key, label: labels?.[key] || key, count })).sort((a, b) => b.count - a.count);
}

// Desglose con conversión: de las conversaciones que llegaron así en el periodo, cuántas aceptaron (en cualquier momento).
function conversionBy(list, keyFn, labels = null) {
  const map = new Map();
  for (const f of list) {
    const k = keyFn(f);
    if (!map.has(k)) map.set(k, { key: k, label: labels?.[k] || k, count: 0, aceptaron: 0 });
    const r = map.get(k); r.count++; if (f.authorized_at) r.aceptaron++;
  }
  return [...map.values()].map(r => ({ ...r, conversion: pct(r.aceptaron, r.count) })).sort((a, b) => b.count - a.count);
}

function insights(current, previous) {
  const out = [];
  for (const m of METRICS) {
    const c = current[m.key], p = previous[m.key];
    if (c === null || p === null || c === undefined || p === undefined) continue;
    if (m.unit === "%") {
      const diff = Math.round((c - p) * 10) / 10;
      if (Math.abs(diff) < 3 || Math.max(current.nuevas, current.respuestas, previous.nuevas) < 10) continue;
      out.push({ key: m.key, label: m.label, current: c, previous: p, change: diff, unit: "pts", good: m.good ? (diff > 0) === (m.good === "up") : null, weight: Math.abs(diff) * 2 });
      continue;
    }
    if (Math.max(c, p) < 5) continue;
    const change = p ? Math.round(((c - p) / p) * 1000) / 10 : null;
    if (change !== null && Math.abs(change) < 15) continue;
    out.push({ key: m.key, label: m.label, current: c, previous: p, change, unit: "%", good: m.good ? (c > p) === (m.good === "up") : null, weight: change === null ? 100 : Math.abs(change) });
  }
  return out.sort((a, b) => (b.good !== null) - (a.good !== null) || b.weight - a.weight).slice(0, 8);
}

export function buildStats({ memories = [], eventsByConv = new Map(), sales = [], timezone = "America/Mexico_City", group = "week", from = null, to = null, compareFrom = null, compareTo = null, now = new Date() } = {}) {
  group = ["day", "week", "month"].includes(group) ? group : "week";
  const local = localParts(timezone);
  const today = local(now).date;
  const valid = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  if (!valid(from) || !valid(to)) ({ from, to } = defaultRange(group, today));
  if (from > to) [from, to] = [to, from];
  if (!valid(compareFrom) || !valid(compareTo)) ({ from: compareFrom, to: compareTo } = previousRange(from, to, group));
  if (compareFrom > compareTo) [compareFrom, compareTo] = [compareTo, compareFrom];

  const memoryById = new Map(memories.map(m => [Number(m.id), m]));
  const facts = [...eventsByConv].map(([id, events]) => conversationFacts(Number(id), events, memoryById.get(Number(id))));
  const inRange = (a, b) => key => key >= a && key <= b;

  const byBucket = accumulate({ facts, eventsByConv, sales, local, keyOf: date => (date >= from && date <= to ? bucketKey(date, group) : null) });
  const total = finish(accumulate({ facts, eventsByConv, sales, local, keyOf: date => (inRange(from, to)(date) ? "x" : null) }).get("x") || emptyRow());
  const prev = finish(accumulate({ facts, eventsByConv, sales, local, keyOf: date => (inRange(compareFrom, compareTo)(date) ? "x" : null) }).get("x") || emptyRow());

  const buckets = bucketKeys(from, to, group).map(key => ({ key, label: bucketLabel(key, group), partial: group !== "day" && key === bucketKey(today, group), ...finish(byBucket.get(key) || emptyRow()) }));

  // Desgloses del periodo actual (conversaciones que empezaron en el periodo).
  const startedIn = facts.filter(f => f.first_at && inRange(from, to)(local(f.first_at).date));
  const activeIn = facts.filter(f => f.replies.some(e => inRange(from, to)(local(e.timestamp).date)));
  const authorizedIn = facts.filter(f => f.authorized_at && inRange(from, to)(local(f.authorized_at).date));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [, events] of eventsByConv) for (const e of events) {
    const customerMessage = (e.type === "ai_reply_sent" && e.details?.customer_text) || e.type === "ignored_out_of_schedule";
    if (!customerMessage) continue;
    const p = local(e.timestamp);
    if (inRange(from, to)(p.date)) heat[p.weekday][p.hour]++;
  }

  return {
    generated_at: now.toISOString(),
    group, timezone,
    range: { from, to, label: rangeLabel(from, to) },
    compare: { from: compareFrom, to: compareTo, label: rangeLabel(compareFrom, compareTo) },
    metrics: METRICS,
    totals: total,
    previous: prev,
    buckets,
    insights: insights(total, prev),
    breakdowns: {
      entry: conversionBy(startedIn, f => f.entry, ENTRY_LABELS),
      need: conversionBy(startedIn, f => f.need, NEED_LABELS),
      age: conversionBy(startedIn, f => f.age),
      plan: countBy(authorizedIn, f => f.plan),
      deferral: countBy(activeIn.filter(f => f.deferral), f => f.deferral, DEFERRAL_LABELS),
    },
    heatmap: { weekdays: WEEKDAYS, cells: heat },
    detail: buildDetail({ facts, sales, local, from, to, compareFrom, compareTo, group }),
    notes: {
      response_time: total.tiempo_respuesta === null ? "El tiempo de respuesta se mide desde el 29-oct; antes no se guardaba la hora del mensaje del cliente." : null,
    },
  };
}

// ── Desglose detallado (17-nov): embudo, anuncios a fondo, días y horas, IMSS, tiempos, seguimientos y tipos de respuesta.
const FUNNEL_STEPS = [
  ["nuevas", "Conversaciones nuevas"],
  ["contestaron", "Contestaron a la primera respuesta"],
  ["precio", "Recibieron precio de los planes"],
  ["cierre", "Se les preguntó si iniciamos"],
  ["aceptaron", "Aceptaron iniciar"],
  ["documentos", "Documentos completos"],
  ["altas", "Alta vigente"],
  ["pagadas", "Pagaron"],
];
const IMSS_LABELS = { si: "Ya tiene IMSS", no: "No tiene IMSS", sin_dato: "Sin dato" };
const HOUR_BLOCKS = [[0, 6, "Madrugada (0 a 6 h)"], [7, 11, "Mañana (7 a 11 h)"], [12, 15, "Mediodía (12 a 15 h)"], [16, 19, "Tarde (16 a 19 h)"], [20, 23, "Noche (20 a 23 h)"]];
const VARIANT_LABELS = { A: "Versión A (actual)", B: "Versión B (prueba)" };

function funnelCounts(list, saleOf) {
  const c = { nuevas: list.length, contestaron: 0, precio: 0, cierre: 0, aceptaron: 0, documentos: 0, altas: 0, pagadas: 0, a_persona: 0, pospusieron: 0, expedientes: 0, ingreso: 0 };
  for (const f of list) {
    const sale = saleOf(f.id);
    if (f.customer_turns >= 2) c.contestaron++;
    if (f.price_at) c.precio++;
    if (f.close_at) c.cierre++;
    if (f.authorized_at) c.aceptaron++;
    if (f.documents_at) c.documentos++;
    if (f.handoff_at) c.a_persona++;
    if (f.deferral) c.pospusieron++;
    if (sale) c.expedientes++;
    if (sale?.validity?.confirmed_at) c.altas++;
    if (sale?.payment?.validated_at) { c.pagadas++; c.ingreso += PRICE[sale.sale?.plan] || 0; }
  }
  return c;
}

function conversionList(list, keyFn, labels = null, order = null) {
  const rows = conversionBy(list, keyFn, labels);
  return order ? order.map(k => rows.find(r => r.key === k) || { key: k, label: labels?.[k] || k, count: 0, aceptaron: 0, conversion: 0 }) : rows;
}

export function buildDetail({ facts, sales, local, from, to, compareFrom, compareTo, group }) {
  const saleByConv = new Map();
  for (const s of sales) if (s.conversation_id) { const k = Number(s.conversation_id); const prev = saleByConv.get(k); if (!prev || ms(s.created_at) > ms(prev.created_at)) saleByConv.set(k, s); }
  const saleOf = id => saleByConv.get(Number(id)) || null;
  const started = (a, b) => facts.filter(f => f.first_at && local(f.first_at).date >= a && local(f.first_at).date <= b);
  const cur = started(from, to);
  const prev = started(compareFrom, compareTo);

  const fc = funnelCounts(cur, saleOf), fp = funnelCounts(prev, saleOf);
  const funnel = FUNNEL_STEPS.map(([key, label], i) => ({
    key, label, count: fc[key], previous: fp[key],
    pct_total: pct(fc[key], fc.nuevas), pct_prev_step: i ? pct(fc[key], fc[FUNNEL_STEPS[i - 1][0]]) : null,
    previous_pct_total: pct(fp[key], fp.nuevas),
  }));

  // Anuncios: cada forma de llegar con su embudo completo, lo que buscan, plan, por qué se quedan, versiones A/B y tendencia.
  const keys = bucketKeys(from, to, group);
  const ads = [...new Set([...cur, ...prev].map(f => f.entry))].map(key => {
    const list = cur.filter(f => f.entry === key);
    const before = prev.filter(f => f.entry === key);
    const c = funnelCounts(list, saleOf), p = funnelCounts(before, saleOf);
    const accepted = list.filter(f => f.authorized_at);
    const variants = new Map();
    for (const f of list) for (const e of f.experiments) {
      if (!e.slot.startsWith(`ad_opening:${key}`)) continue;
      if (!variants.has(e.variant)) variants.set(e.variant, { key: e.variant, label: VARIANT_LABELS[e.variant] || `Versión ${e.variant}`, count: 0, contestaron: 0, aceptaron: 0 });
      const v = variants.get(e.variant); v.count++; if (f.customer_turns >= 2) v.contestaron++; if (f.authorized_at) v.aceptaron++;
    }
    const texts = key === "direct" ? [] : countBy(list.filter(f => f.first_text), f => f.first_text).slice(0, 5).map(r => ({ text: r.key, count: r.count }));
    const trend = keys.map(k => {
      const inBucket = list.filter(f => bucketKey(local(f.first_at).date, group) === k);
      return { key: k, label: bucketLabel(k, group), nuevas: inBucket.length, aceptaron: inBucket.filter(f => f.authorized_at).length };
    });
    return {
      key, label: ENTRY_LABELS[key] || key, ...c,
      conversion: pct(c.aceptaron, c.nuevas), reply_rate: pct(c.contestaron, c.nuevas), close_rate: pct(c.aceptaron, c.cierre),
      hours_to_accept: median(accepted.map(f => Math.round((ms(f.authorized_at) - ms(f.first_at)) / 360000) / 10)),
      previous: { nuevas: p.nuevas, aceptaron: p.aceptaron, conversion: pct(p.aceptaron, p.nuevas), reply_rate: pct(p.contestaron, p.nuevas) },
      needs: conversionList(list, f => f.need, NEED_LABELS),
      plans: countBy(accepted, f => f.plan),
      deferrals: countBy(list.filter(f => f.deferral), f => f.deferral, DEFERRAL_LABELS),
      imss: conversionList(list, f => f.tiene_imss, IMSS_LABELS),
      variants: [...variants.values()].map(v => ({ ...v, reply_rate: pct(v.contestaron, v.count), conversion: pct(v.aceptaron, v.count) })).sort((a, b) => a.key.localeCompare(b.key)),
      texts, trend,
    };
  }).filter(a => a.nuevas || a.previous.nuevas).sort((a, b) => b.nuevas - a.nuevas || b.previous.nuevas - a.previous.nuevas);

  const blockOf = f => HOUR_BLOCKS.find(([a, b]) => { const h = local(f.first_at).hour; return h >= a && h <= b; })?.[2];
  const accepted = cur.filter(f => f.authorized_at);
  const hours = accepted.map(f => (ms(f.authorized_at) - ms(f.first_at)) / 3600000);
  const within = (a, b) => hours.filter(h => h >= a && h < b).length;
  const inRange = iso => { const d = iso ? local(iso).date : ""; return d >= from && d <= to; };
  const withFollowup = cur.filter(f => f.followups.length);
  const sources = new Map();
  let replies = 0;
  for (const f of facts) for (const e of f.replies) {
    if (!inRange(e.timestamp)) continue;
    replies++;
    const raw = String(e.details?.decision_source || "—");
    const key = raw.startsWith("direct:") ? "direct:*" : raw.startsWith("team_answer:") ? "team_answer:*" : raw.startsWith("commitment:") ? "commitment:*" : raw.startsWith("ad_opening:") ? "ad_opening:*" : raw.startsWith("case_diagnosis:") && raw !== "case_diagnosis:reprompt" ? "case_diagnosis:*" : raw;
    sources.set(key, (sources.get(key) || 0) + 1);
  }
  const directKeys = new Map();
  for (const f of facts) for (const e of f.replies) {
    const raw = String(e.details?.decision_source || "");
    if (raw.startsWith("direct:") && inRange(e.timestamp)) { const k = raw.slice(7); directKeys.set(k, (directKeys.get(k) || 0) + 1); }
  }

  // Prueba A/B del modo de Mia (17-nov): A = Mia completa, B = modo ligero; solo conversaciones nuevas.
  const modes = [["A", "Mia normal"], ["B", "Mia libre"]].map(([key, label]) => {
    const list = cur.filter(f => f.experiments.some(e => e.slot === "mia_mode" && e.variant === key));
    const c = funnelCounts(list, saleOf);
    return { key, label, ...c, reply_rate: pct(c.contestaron, c.nuevas), conversion: pct(c.aceptaron, c.nuevas), close_rate: pct(c.aceptaron, c.cierre) };
  }).filter(r => r.nuevas);

  return {
    funnel,
    modes,
    ads,
    weekday: conversionList(cur, f => WEEKDAYS[local(f.first_at).weekday], null, WEEKDAYS),
    hour_block: conversionList(cur, blockOf, null, HOUR_BLOCKS.map(b => b[2])),
    imss: conversionList(cur, f => f.tiene_imss, IMSS_LABELS, ["no", "si", "sin_dato"]),
    timing: {
      accepted: accepted.length,
      median_hours: hours.length ? Math.round(median(hours.map(h => Math.round(h * 10))) ) / 10 : null,
      median_messages: median(accepted.map(f => f.turns_to_accept || 0)),
      within_1h: within(0, 1), within_24h: within(1, 24), within_72h: within(24, 72), later: hours.filter(h => h >= 72).length,
    },
    followups: {
      conversations: withFollowup.length,
      replied: withFollowup.filter(f => f.replied_after_followup).length,
      accepted: withFollowup.filter(f => f.accepted_after_followup).length,
      reply_rate: pct(withFollowup.filter(f => f.replied_after_followup).length, withFollowup.length),
    },
    sources: [...sources].map(([key, count]) => ({ key, count, share: pct(count, replies) })).sort((a, b) => b.count - a.count).slice(0, 15),
    direct_answers: [...directKeys].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    replies,
  };
}

function rangeLabel(from, to) {
  const d = s => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  return from === to ? d(from) : `${d(from)} – ${d(to)}`;
}
