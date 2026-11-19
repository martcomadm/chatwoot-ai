import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MiaConsole, sourceLabel, sourceKind } from "../src/inspector/mia-console.js";
import { miaInspectorPage } from "../src/inspector/mia-page.js";
import { MemoryStore } from "../src/memory/memory-store.js";
import { InspectorEventStore } from "../src/inspector/event-store.js";
import { AfterHoursQueue } from "../src/core/after-hours-queue.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-insp-"));
const ago = min => new Date(Date.now() - min * 60000).toISOString();

async function setup() {
  const dir = tmp();
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"), 200);
  await memories.set(1, { nombre: "María", sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", deferral: "no_money" } });
  await memories.set(2, { nombre: "José", sales_cycle: { stage: "authorized", recommended_plan: "plan_2", authorized: true } });
  const add = (id, min, type, details) => { events.data[id] ||= []; events.data[id].push({ id: `${id}${min}${type}`, timestamp: ago(min), type, details }); };
  add(1, 50, "ai_reply_sent", { customer_text: "si quiero pero no tengo dinero", reply: "¿Me compartes un poco más sobre tu situación?", decision_source: "fallback" });
  add(1, 40, "ai_reply_sent", { customer_text: "si ok gracias", reply: "¿Me compartes un poco más sobre tu situación?", decision_source: "fallback" });
  add(2, 30, "authorized_sale_workflow", {});
  add(2, 30, "ai_reply_sent", { customer_text: "Muy bien", reply: "Compárteme tu CURP", decision_source: "onboarding" });
  add(2, 20, "ai_error", { error: "timeout" });
  const afterHours = new AfterHoursQueue(path.join(dir, "q.json"));
  afterHours.add(3, ["9"], new Date());
  const console_ = new MiaConsole({
    config: { ai: { timezone: "America/Mexico_City", schedule: "1-5=7-21;6=8-16" }, openai: { model: "gpt-5-mini" }, inspector: { adminToken: "x" } },
    memories, inspectorEvents: events, afterHours,
    chatwoot: { async getMessages() { throw new Error("sin red"); } },
  });
  return { console_ };
}

test("etiquetas de origen de cada respuesta", () => {
  assert.equal(sourceLabel("llm"), "IA");
  assert.equal(sourceLabel("commitment:authorized"), "Regla · cierre de venta");
  assert.equal(sourceLabel("direct:price"), "Respuesta oficial");
  assert.equal(sourceKind("fallback_ai_error"), "respaldo");
  assert.equal(sourceKind("progressive_opening"), "regla");
});

test("Hoy: indicadores, pendientes de atención y cola de horario", async () => {
  const { console_ } = await setup();
  const live = console_.live();
  assert.equal(live.kpis.replies_today >= 3, true);
  assert.equal(live.kpis.waiting_schedule, 1);
  assert.equal(live.kpis.errors_today, 1);
  assert.equal(live.kpis.authorized_today, 1);
  const reasons = Object.fromEntries(live.attention.map(a => [a.id, a.reasons.join(",")]));
  assert.match(reasons[1], /Respuesta repetida/);
  assert.match(reasons[2], /error/);
});

test("Calidad: marca respuestas genéricas y repetidas en un solo caso", async () => {
  const { console_ } = await setup();
  const q = console_.quality({ days: 7 });
  const maria = q.items.filter(i => i.id === 1);
  assert.equal(maria.length, 2);
  assert.deepEqual(maria[0].flags.sort(), ["generica", "repetida"]);
  assert.equal(q.counts.find(c => c.key === "error").count, 1);
  assert.equal(q.sources.respaldo, 2);
});

test("Conversación: sin Chatwoot se arma con lo registrado por Mia", async () => {
  const { console_ } = await setup();
  const c = await console_.conversation(1);
  assert.match(c.transcript_error, /sin red/);
  assert.deepEqual(c.transcript.map(m => m.who), ["cliente", "mia", "cliente", "mia"]);
  assert.ok(c.transcript[3].flags.includes("repetida"));
  assert.equal(c.facts.find(f => f.label === "Pospuso").value, "Sin dinero por ahora");
});

test("Embudo: etapas acumuladas y motivos de salida", async () => {
  const { console_ } = await setup();
  const f = console_.funnel({ days: 30 });
  assert.equal(f.stages[0].count, 2);
  assert.equal(f.stages.find(s => s.key === "authorized").count, 1);
  assert.equal(f.exits.find(e => e.key === "no_money").count, 1);
});

test("la página nueva incluye su CSS y JS", () => {
  const html = miaInspectorPage();
  assert.match(html, /Inspector de Mia/);
  assert.doesNotMatch(html, /__MIA_(CSS|JS)__/);
});
