// 11-nov: (1) tiempo de respuesta a los avisos y aviso a Supervisión, (2) "no pagas hasta que tu alta esté vigente",
// (3) respuesta por anuncio, (5) embudo después del "sí".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { buildImpact, afterYesFunnel, responseSummary } from "../src/inspector/impact-service.js";
import { untakenAlerts, AlertEscalation } from "../src/operations/alert-escalation.js";
import { orchestrateConversation, PAY_AFTER } from "../src/orchestrator/conversation-orchestrator.js";
import { deferralDecision } from "../src/sales/customer-deferral.js";
import { ExperimentStore, SLOTS } from "../src/knowledge/experiments.js";
import { FOLLOWUP_PAY_AFTER_B } from "../src/core/follow-up.js";

const T0 = Date.parse("2026-11-10T16:00:00Z");
const ev = (type, min, details = {}) => ({ type, timestamp: new Date(T0 + min * 60000).toISOString(), details });

test("Impacto: tiempo en que el equipo toma los avisos, por tipo y por persona", () => {
  const eventsByConv = new Map([
    [1, [ev("ai_reply_sent", 0, { customer_text: "Hola" }), ev("ai_reply_sent", 1, { customer_text: "cómo pago" }), ev("hot_lead_alert", 2), ev("capture_intervention", 12, { by: "Erika" }), ev("authorized_sale_workflow", 60)]],
    [2, [ev("ai_reply_sent", 0, { customer_text: "Hola" }), ev("cold_lead_alert", 120, { kind: "cold_lead" }), ev("capture_intervention", 200, { by: "Erika" })]],
    [3, [ev("ai_reply_sent", 0, { customer_text: "Hola" }), ev("cold_lead_alert", 120, { kind: "cold_lead" })]],
    [4, [ev("ai_reply_sent", 0, { customer_text: "Hola" }), ev("cold_lead_alert", 120, { kind: "missing_docs" })]],
  ]);
  const impact = buildImpact({ eventsByConv, since: "2026-11-10", to: "2026-11-10", now: new Date(T0 + 24 * 3600 * 1000) });
  const r = impact.after.response;
  assert.deepEqual(r.hot, { alerts: 1, taken: 1, taken_pct: 100, within_15: 1, median_minutes: 10, untaken: 0 });
  assert.deepEqual([r.cold.alerts, r.cold.taken, r.cold.untaken, r.cold.median_minutes, r.cold.within_15], [2, 1, 1, 80, 0], "el aviso de documentos no cuenta aquí");
  assert.deepEqual(r.people, [{ name: "Erika", taken: 2, within_15: 1, median_minutes: 45, saved: 1 }]);
  // Por anuncio: cuántos contestan a Mia después de la primera respuesta.
  assert.equal(impact.entries[0].replied_after, 25);
  assert.equal(responseSummary([]).hot.taken_pct, null);
});

test("Impacto: embudo después del 'sí' con los expedientes del periodo", () => {
  const base = { created_at: "2026-11-10T18:00:00Z", queue: "capture", status: "waiting_capture", documents: { complete: false }, capture: {}, validity: {}, payment: {} };
  const sales = [
    base,
    { ...base, capture: { scheduled: { date: "2026-11-16" } } },
    { ...base, documents: { complete: true }, capture: { completed_at: "x" }, queue: "validation", status: "waiting_validation" },
    { ...base, documents: { complete: true }, capture: { completed_at: "x" }, validity: { confirmed: true }, payment: { requested: true, received: true, amount: 1100 }, queue: null, status: "completed" },
    { ...base, status: "cancelled", queue: null },
    { ...base, created_at: "2026-11-01T18:00:00Z" },
  ];
  const f = buildImpact({ sales, since: "2026-11-10", to: "2026-11-10", now: new Date("2026-11-11T18:00:00Z") }).after.funnel;
  assert.equal(f.total, 5);
  assert.deepEqual(f.steps.map(s => s.count), [5, 2, 2, 1, 1, 1]);
  assert.equal(f.steps[5].pct, 20);
  assert.equal(f.cancelled, 1);
  assert.equal(f.revenue, 1100);
  assert.deepEqual(Object.fromEntries(f.stuck), { "En Captura (faltan documentos)": 1, "En Captura (alta agendada)": 1, "En Validación": 1 });
  assert.equal(afterYesFunnel([]).total, 0);
});

test("aviso sin tomar a los 15 min: Supervisión se entera, una sola vez", async () => {
  const now = new Date("2026-11-11T18:00:00Z");
  const ago = m => new Date(now.getTime() - m * 60000).toISOString();
  const data = new Map([
    [1, { id: 1, nombre: "Ana", hot_lead_alert: { at: ago(20), reason: "Preguntó cómo pagar" }, sales_cycle: {} }],
    [2, { id: 2, nombre: "Luis", cold_lead_alert: { at: ago(40) }, sales_cycle: {} }],
    [3, { id: 3, nombre: "Reciente", hot_lead_alert: { at: ago(5) }, sales_cycle: {} }],
    [4, { id: 4, nombre: "Tomado", hot_lead_alert: { at: ago(30) }, capture_intervention: { active: false, at: ago(25) }, sales_cycle: {} }],
    [5, { id: 5, nombre: "Omitido", hot_lead_alert: { at: ago(30) }, mia_omitted: { active: true }, sales_cycle: {} }],
    [6, { id: 6, nombre: "Aceptó", hot_lead_alert: { at: ago(30) }, sales_cycle: { authorized: true } }],
    [7, { id: 7, nombre: "Viejo", cold_lead_alert: { at: ago(600) }, sales_cycle: {} }],
  ]);
  const memories = { list: () => [...data.values()], async merge(id, patch) { data.set(id, { ...data.get(id), ...patch }); } };
  assert.deepEqual(untakenAlerts(memories.list(), { now }).map(i => [i.id, i.kind, i.minutes]), [[1, "hot", 20], [2, "cold", 40]]);
  const sent = [];
  const service = new AlertEscalation({ memories, notifier: { areaUsers: a => (a === "supervision" ? ["jefa"] : []), notify: async n => sent.push(n) } });
  assert.deepEqual(await service.tick(now), { escalated: 2 });
  assert.deepEqual(sent[0].to, ["jefa"]);
  assert.match(sent[0].title, /2 avisos sin tomar en Captura/);
  assert.match(sent[0].body, /Ana \(#1\): preguntó cómo pagar, hace 20 min · Luis \(#2\): interesado sin responder, hace 40 min/);
  assert.deepEqual(await service.tick(new Date(now.getTime() + 5 * 60000)), { escalated: 0 }, "no se repite");
  assert.deepEqual(await new AlertEscalation({ memories, notifier: {}, isOpen: () => false }).tick(now), { escalated: 0 });
});

test("'no pagas nada por adelantado' en ubicación, visita a oficina y 'lo pienso'", () => {
  const PLAN = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], pitched_plans: ["plan_1"] } };
  assert.ok(orchestrateConversation("¿Dónde se ubican? Yo soy de Puebla", PLAN).directAnswer.includes(PAY_AFTER));
  const visit = orchestrateConversation("Me gustaría visitarlos en su empresa", PLAN).directAnswer;
  assert.ok(visit.includes(PAY_AFTER) && visit.length <= 850);
  assert.match(deferralDecision(PLAN, "lo pienso y le aviso").reply, /para iniciar no pagas nada: tu primer pago es hasta que compruebas en el IMSS que tu alta ya está vigente/);
  assert.match(deferralDecision({}, "lo pienso y le aviso").reply, /Aquí estaré para ayudarte/, "sin plan no se habla de pago");
  assert.match(deferralDecision(PLAN, "lo pienso y le aviso").reply, SLOTS["customer_deferral:later"].match);
});

test("el primer seguimiento entra a prueba A/B con el argumento del pago", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-ab-"));
  const store = new ExperimentStore(path.join(dir, "e.json"));
  const item = store.seed({ slot: "followup:plan:0", name: "x", bText: FOLLOWUP_PAY_AFTER_B });
  assert.ok(item, "la versión B es válida para ese mensaje");
  assert.equal(store.seed({ slot: "followup:plan:0", name: "x", bText: FOLLOWUP_PAY_AFTER_B }), null);
});
