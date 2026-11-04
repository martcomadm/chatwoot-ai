import test from "node:test";
import assert from "node:assert/strict";
import { ColdLeadAlerts, coldLeadSkipReason } from "../src/operations/cold-lead-alerts.js";

// Punto 2 (4-nov): cliente que vio el plan y lleva 2 h sin contestar → aviso a Captura.
const now = new Date("2026-11-04T15:00:00Z");
const ago = h => new Date(now.getTime() - h * 3600000).toISOString();
const pitched = { nombre: "Rosa López", sales_cycle: { pitched_plans: ["plan_1"], recommended_plan: "plan_1" } };

function setup(memoriesById, entries, { open = true } = {}) {
  const mem = structuredClone(memoriesById);
  const sent = [], events = [];
  const alerts = new ColdLeadAlerts({
    followUpStore: { list: () => entries },
    memories: { get: id => mem[id], async merge(id, patch) { mem[id] = { ...(mem[id] || {}), ...patch }; } },
    notifier: { areaUsers: area => (area === "captura" ? ["carla", "pepe"] : []), async notify(n) { sent.push(n); } },
    inspectorEvents: { async record(id, type, d) { events.push({ id, type, d }); } },
    isOpen: () => open,
  });
  return { alerts, sent, events, mem };
}

test("avisa una sola vez a Captura con enlace al chat", async () => {
  const { alerts, sent, events, mem } = setup({ 10: pitched }, [{ conversationId: 10, mia_at: ago(2.5) }]);
  assert.deepEqual(await alerts.tick(now), { alerted: 1 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["carla", "pepe"]);
  assert.equal(sent[0].kind, "cold_lead");
  assert.equal(sent[0].url, "/operations?area=chats&chat=10");
  assert.match(sent[0].body, /^Rosa López vio el Plan 1 \(\$1,100\) y no contesta desde hace 2 h · #10/);
  assert.equal(events[0].type, "cold_lead_alert");
  assert.equal(mem[10].cold_lead_alert.for_mia_at, ago(2.5));
  assert.deepEqual(await alerts.tick(now), { alerted: 0 }, "no se repite por el mismo silencio");
});

test("no avisa: antes de 2 h, fuera de horario, sin plan visto, ya aceptó, pospuso, intervenido o con una persona", async () => {
  const entry = h => [{ conversationId: 10, mia_at: ago(h) }];
  assert.equal((await setup({ 10: pitched }, entry(1)).alerts.tick(now)).alerted, 0);
  assert.equal((await setup({ 10: pitched }, entry(3), { open: false }).alerts.tick(now)).alerted, 0);
  assert.equal(coldLeadSkipReason(pitched, { mia_at: ago(30) }, now), "too_old");
  assert.equal(coldLeadSkipReason({ sales_cycle: {} }, { mia_at: ago(3) }, now), "no_plan_seen");
  assert.equal(coldLeadSkipReason({ sales_cycle: { ...pitched.sales_cycle, authorized: true } }, { mia_at: ago(3) }, now), "authorized");
  assert.equal(coldLeadSkipReason({ sales_cycle: { ...pitched.sales_cycle, deferral: "later" } }, { mia_at: ago(3) }, now), "deferred");
  assert.equal(coldLeadSkipReason({ ...pitched, capture_intervention: { active: true } }, { mia_at: ago(3) }, now), "intervened");
  assert.equal(coldLeadSkipReason({ ...pitched, handoff: { status: "assigned" } }, { mia_at: ago(3) }, now), "human");
});

test("si vuelve a quedarse callado después de contestar, se avisa otra vez", async () => {
  const { alerts, sent } = setup({ 10: { ...pitched, cold_lead_alert: { for_mia_at: ago(30) } } }, [{ conversationId: 10, mia_at: ago(2) }]);
  assert.equal((await alerts.tick(now)).alerted, 1);
  assert.equal(sent.length, 1);
});
