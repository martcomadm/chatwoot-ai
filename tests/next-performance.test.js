// 17-nov (lentitud del sitio): los eventos se guardan agrupados y las lecturas usan caché que se renueva con cada evento.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { InspectorEventStore, flushInspectorEventStores } from "../src/inspector/event-store.js";
import { MiaConsole } from "../src/inspector/mia-console.js";
import { buildModeSummary } from "../src/inspector/stats-service.js";

test("los eventos se escriben agrupados, sin formato, y se guardan al apagar", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-ev-")), "e.json");
  const store = new InspectorEventStore(file, 200, { persistDelayMs: 50 });
  await store.record(1, "a", { x: 1 });
  await store.record(1, "b", {});
  assert.equal(store.listAll().length, 2, "se ve de inmediato aunque no se haya escrito");
  await store.flush();
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("\n  "), "sin formato bonito");
  assert.equal(JSON.parse(raw)["1"].length, 2);
  await store.record(2, "c", {});
  flushInspectorEventStores();
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))["2"].length, 1);
});

test("la caché de eventos se renueva al llegar uno nuevo y el resumen de Mia libre cuenta solo los repartidos", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-ev-")), "e.json");
  const events = new InspectorEventStore(file, 200, { persistDelayMs: 10 });
  const memories = [{ id: 1, mia_mode: "light" }, { id: 2, mia_mode: "full" }, { id: 3 }];
  const mc = new MiaConsole({ config: { ai: {} }, memories: { list: () => memories }, inspectorEvents: events });
  await events.record(1, "ai_reply_sent", { customer_text: "Hola", reply: "Plan 1 $1,100" });
  assert.equal(mc.eventsByConversation().size, 1);
  await events.record(2, "ai_reply_sent", { customer_text: "Hola", reply: "x" });
  await events.record(3, "ai_reply_sent", { customer_text: "Hola", reply: "x" });
  assert.equal(mc.eventsByConversation().size, 3, "se renovó");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const rows = buildModeSummary({ memories, eventsByConv: mc.eventsByConversation(), from: today, to: today });
  assert.deepEqual(rows.map(r => [r.label, r.nuevas, r.precio]), [["Mia normal", 1, 0], ["Mia libre", 1, 1]]);
  await events.flush();
});
