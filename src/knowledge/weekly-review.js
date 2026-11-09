// Aprendizaje semanal (pedido 9-nov, punto 2 de "Mia más inteligente").
// Cada lunes (o al tocar "Generar ahora") Mia revisa las conversaciones de la semana y le deja a Supervisión:
//   · el embudo (cuántos vieron el plan, recibieron el cierre, aceptaron, completaron documentos),
//   · dónde se van los que no compran (etapa y última respuesta de Mia antes del silencio),
//   · los motivos (objeciones y "lo pospone"),
//   · las preguntas que se quedaron sin buena respuesta, agrupadas, con una respuesta propuesta que
//     Supervisión aprueba o descarta en "Preguntas que Mia no supo",
//   · qué dijo Mia justo antes de que alguien aceptara.
// Es lo mismo que se hacía a mano con cada export, pero automático.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { mxDay, mxHour, mxWeekday } from "../core/team-days.js";

const DAY = 24 * 3600 * 1000;
const ms = v => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };
const norm = v => String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("a al como con cual cuando de del donde el en es esa ese eso esta este esto hay la las le lo los mas me mi mis muy no o para pero por que se si sin su sus te tengo tiene tu un una uno y ya yo usted ustedes buenas buenos dias tardes noches hola gracias favor ok bien".split(" "));
const content = t => new Set(norm(t).split(" ").filter(w => w.length > 2 && !STOP.has(w)));
// Parecido: palabras en común entre la pregunta más corta (al menos 2 en común).
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n < 2 ? 0 : n / Math.min(a.size, b.size); };

// Respuestas que no contestan lo que el cliente dijo.
const WEAK_SOURCES = /^(?:fallback|unknown|llm_repair_failed)/;
const WEAK_REPLIES = [
  /^¿Tienes alguna duda sobre el Plan [12] o quieres que iniciemos tu trámite\?$/,
  /^Si te parece bien, ¿iniciamos tu trámite con el Plan [12]\?$/,
  /^¿Me compartes un poco más sobre tu situación\?$/,
  /^Para orientarte mejor, ¿qué buscas principalmente/,
  /^¿Qué te interesa principalmente: servicio médico, semanas, INFONAVIT o AFORE\?$/,
];
const isWeak = e => WEAK_SOURCES.test(String(e.details?.decision_source || "")) || WEAK_REPLIES.some(re => re.test(String(e.details?.reply || "").trim()));
const CLOSE_RE = /iniciemos tu trámite|iniciamos tu trámite|apartarte un lugar|te aparto un lugar/;

const SOURCE_LABELS = {
  contextual_plan_explanation: "Explicación del plan", compact_plan_recommendation: "Recomendación del plan", need_discovery: "Pregunta de necesidad",
  progressive_opening: "Apertura", price_objection: "Objeción de precio", customer_deferral: "Despedida por 'lo pospone'", customer_closing: "Despedida",
  llm: "Respuesta de la IA", llm_repair: "Respuesta de la IA (corregida)", fallback: "Respuesta genérica", unknown: "Respuesta genérica",
  onboarding: "Petición de documentos", case_diagnosis: "Diagnóstico del caso", reactivation_reply: "Respuesta a la reactivación", team_answer: "Respuesta del equipo",
};
export const sourceLabel = s => { const v = String(s || "unknown"); if (v.startsWith("direct:")) return `Respuesta fija · ${v.slice(7)}`; return SOURCE_LABELS[v] || SOURCE_LABELS[v.split(":")[0]] || v; };

const STAGES = [["accepted", "Aceptó"], ["close", "Recibió la pregunta de cierre"], ["explained", "Le explicaron el plan"], ["saw_plan", "Vio el plan y el precio"], ["started", "Solo platicó (sin plan)"], ["one", "Escribió una vez y no volvió"]];
const DEFERRAL_LABELS = { no_money: "Sin dinero por ahora", later: "Lo pospone / lo pensará", start_later: "Enviará documentos después", declined: "No le interesa", closing: "Se despidió", not_fit: "No es lo que busca", mistake: "Se equivocó de chat" };

function bump(map, key, extra) { const e = map.get(key) || { key, count: 0, examples: [] }; e.count++; if (extra && e.examples.length < 3) e.examples.push(extra); map.set(key, e); return e; }
const top = (map, n = 8) => [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);

export function buildWeeklyReview({ memories = [], events = [], since, until, experiments = [] } = {}) {
  const byConv = new Map();
  for (const e of events) {
    const id = Number(e.conversationId);
    if (!id) continue;
    if (!byConv.has(id)) byConv.set(id, []);
    byConv.get(id).push(e);
  }
  const memById = new Map(memories.map(m => [Number(m.id), m]));
  const funnel = { chats: 0, saw_plan: 0, explained: 0, close: 0, accepted: 0, docs: 0 };
  const stages = new Map(); const dropAfter = new Map(); const reasons = new Map(); const winners = new Map();
  const weak = [];
  for (const [id, list] of byConv) {
    list.sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
    const first = ms(list[0]?.timestamp);
    if (first < since || first >= until) continue; // chats nuevos de la semana
    const memory = memById.get(id) || {};
    const c = memory.sales_cycle || {};
    const replies = list.filter(e => e.type === "ai_reply_sent");
    if (!replies.length) continue;
    funnel.chats++;
    const saw = Boolean((c.pitched_plans || []).length || (c.explained_plans || []).length || c.recommended_plan || replies.some(e => /\$1,100|\$1,500/.test(e.details?.reply || "")));
    const explained = Boolean((c.fully_explained_plans || c.explained_plans || []).length);
    const close = replies.some(e => CLOSE_RE.test(e.details?.reply || ""));
    const accepted = Boolean(c.authorized);
    if (saw) funnel.saw_plan++;
    if (explained) funnel.explained++;
    if (close) funnel.close++;
    if (accepted) funnel.accepted++;
    if (memory.operations?.documents_complete) funnel.docs++;
    const customerTurns = replies.filter(e => e.details?.customer_text).length;
    const stage = accepted ? "accepted" : close ? "close" : explained ? "explained" : saw ? "saw_plan" : customerTurns <= 1 ? "one" : "started";
    bump(stages, stage);
    for (const e of replies) {
      if (isWeak(e) && e.details?.customer_text) weak.push({ id, text: String(e.details.customer_text).slice(0, 300), reply: String(e.details.reply || "").slice(0, 200) });
    }
    if (accepted) {
      // Lo que dijo Mia justo antes de que aceptara (sin contar la petición de documentos que vino después).
      const at = ms(c.authorized_at);
      const isOnb = e => /^onboarding/.test(String(e.details?.decision_source || ""));
      const firstOnb = replies.findIndex(isOnb);
      const before = (at ? replies.filter(e => ms(e.timestamp) < at) : firstOnb >= 0 ? replies.slice(0, firstOnb) : replies.slice(0, -1)).filter(e => !isOnb(e));
      const pick = before.at(-1);
      if (pick) bump(winners, sourceLabel(pick.details?.decision_source), { id, mia: String(pick.details?.reply || "").slice(0, 220), customer: String(c.authorization_text || "").slice(0, 160) });
    } else {
      const last = replies.at(-1);
      bump(dropAfter, sourceLabel(last?.details?.decision_source), { id, mia: String(last?.details?.reply || "").slice(0, 160) });
      const d = c.deferral && DEFERRAL_LABELS[c.deferral];
      if (d) bump(reasons, d);
      if (memory.profile?.objection) bump(reasons, `Objeción: ${memory.profile.objection}`);
    }
  }
  // Preguntas sin buena respuesta, agrupadas por parecido.
  const clusters = [];
  for (const w of weak) {
    const words = content(w.text);
    if (words.size < 2) continue;
    const hit = clusters.find(cl => overlap(cl.first, words) >= 0.5);
    if (hit) { hit.count++; if (hit.examples.length < 4 && !hit.examples.some(x => x.text === w.text)) hit.examples.push(w); for (const x of words) hit.words.add(x); if (!hit.ids.includes(w.id)) hit.ids.push(w.id); }
    else clusters.push({ first: words, words: new Set(words), count: 1, examples: [w], ids: [w.id] });
  }
  const unanswered = clusters.sort((a, b) => b.count - a.count).slice(0, 12).map(cl => ({ count: cl.count, question: cl.examples[0].text, examples: cl.examples.map(x => ({ id: x.id, text: x.text, reply: x.reply })), conversations: cl.ids.slice(0, 10) }));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return {
    since: new Date(since).toISOString(), until: new Date(until).toISOString(),
    funnel: { ...funnel, saw_plan_pct: pct(funnel.saw_plan, funnel.chats), close_pct: pct(funnel.close, funnel.chats), accepted_pct: pct(funnel.accepted, funnel.chats), accepted_of_close_pct: pct(funnel.accepted, funnel.close) },
    stages: STAGES.map(([key, label]) => ({ key, label, count: stages.get(key)?.count || 0 })),
    drop_after: top(dropAfter, 8),
    reasons: top(reasons, 8),
    unanswered,
    winners: top(winners, 6),
    weak_replies: weak.length,
    experiments,
  };
}

export class WeeklyReviewService {
  constructor({ file, memories, inspectorEvents, learningInbox = null, ai = null, experiments = null, notifier = null }) {
    Object.assign(this, { file, memories, inspectorEvents, learningInbox, ai, experiments, notifier });
    this.state = { reports: [] };
    try { if (file) this.state = { reports: [], ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer el aprendizaje semanal:", error.message); }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  latest() { return this.state.reports.at(-1) || null; }
  list() { return this.state.reports.map(r => ({ id: r.id, since: r.since, until: r.until, created_at: r.created_at, funnel: r.funnel })).reverse(); }
  get(id) { return this.state.reports.find(r => r.id === id) || null; }

  async run({ now = new Date(), days = 7, by = null } = {}) {
    if (this.running) throw new Error("Ya se está generando el aprendizaje semanal");
    this.running = true;
    try {
      const until = Date.parse(`${mxDay(now)}T06:00:00Z`) + (by ? DAY : 0); // manual: incluye hoy
      const since = until - days * DAY;
      const experiments = [];
      for (const item of this.experiments?.list?.() || []) {
        if (item.status !== "active") continue;
        experiments.push({ name: item.name, results: this.experiments.results(item.id, this.memories.list?.() || []) });
      }
      const report = buildWeeklyReview({ memories: this.memories.list?.() || [], events: this.inspectorEvents?.listAll?.() || [], since, until, experiments });
      // Respuesta propuesta por Mia para cada pregunta sin buena respuesta; va a "Preguntas que Mia no supo".
      let proposals = 0;
      for (const q of report.unanswered.slice(0, 8)) {
        let draft = null;
        try { draft = await this.ai?.draftTeamAnswer?.({ question: q.question, examples: q.examples.map(e => e.text) }); } catch (error) { console.error("NEXT propuesta semanal:", error?.message || error); }
        q.proposal = draft || null;
        if (this.learningInbox?.addProposal?.({ question: q.question, answer: draft || "", count: q.count, conversations: q.conversations, now })) proposals++;
      }
      Object.assign(report, { id: crypto.randomUUID(), created_at: now.toISOString(), created_by: by, proposals });
      this.state.reports = [...this.state.reports, report].slice(-12);
      this.persist();
      const to = this.notifier?.areaUsers?.("supervision") || [];
      if (to.length) await this.notifier?.notify?.({ kind: "info", to, title: "Aprendizaje semanal de Mia listo", body: `${report.funnel.chats} chats nuevos · ${report.funnel.accepted} aceptaron (${report.funnel.accepted_pct}%) · ${report.unanswered.length} preguntas sin buena respuesta${proposals ? ` · ${proposals} respuestas propuestas para aprobar` : ""}.`, url: "/operations?area=respuestas&tab=weekly" });
      return report;
    } finally { this.running = false; }
  }

  // Lunes a partir de las 8:00 (hora de México), una vez por semana.
  async tick(now = new Date()) {
    if (mxWeekday(now) !== 1 || mxHour(now) < 8) return null;
    const day = mxDay(now);
    if (this.state.reports.some(r => !r.created_by && mxDay(new Date(r.created_at)) === day)) return null;
    return this.run({ now });
  }

  start(everyMs = 30 * 60 * 1000) {
    this.timer = setInterval(() => this.tick().catch(error => console.error("NEXT aprendizaje semanal:", error?.message || error)), everyMs);
    this.timer.unref?.();
  }
}
