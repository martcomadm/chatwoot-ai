// 17-nov (lentitud del sitio): los eventos se guardan agrupados y las lecturas usan caché que se renueva con cada evento.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { InspectorEventStore, flushInspectorEventStores } from "../src/inspector/event-store.js";
import { MiaConsole } from "../src/inspector/mia-console.js";

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

test("la caché de eventos se renueva al llegar uno nuevo", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-ev-")), "e.json");
  const events = new InspectorEventStore(file, 200, { persistDelayMs: 10 });
  const memories = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const mc = new MiaConsole({ config: { ai: {} }, memories: { list: () => memories }, inspectorEvents: events });
  await events.record(1, "ai_reply_sent", { customer_text: "Hola", reply: "Plan 1 $1,100" });
  assert.equal(mc.eventsByConversation().size, 1);
  await events.record(2, "ai_reply_sent", { customer_text: "Hola", reply: "x" });
  await events.record(3, "ai_reply_sent", { customer_text: "Hola", reply: "x" });
  assert.equal(mc.eventsByConversation().size, 3, "se renovó");
  await events.flush();
});
