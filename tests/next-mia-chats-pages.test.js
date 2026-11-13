import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { MemoryStore } from "../src/memory/memory-store.js";
import { InspectorEventStore } from "../src/inspector/event-store.js";
import { MiaConsole } from "../src/inspector/mia-console.js";

// Chats de Mia en páginas de 40 (pedido 4-nov).
test("Chats de Mia: páginas de 40, la última con el resto y página fuera de rango ajustada", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-miapages-"));
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"));
  for (let id = 1; id <= 95; id++) {
    await memories.merge(id, { nombre: `Cliente ${id}`, sales_cycle: { stage: "exploring" } });
    await events.record(id, "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola!", decision_source: "progressive_opening" });
  }
  const mia = new MiaConsole({ config: { ai: {} }, memories, inspectorEvents: events });
  const p1 = mia.rescueList({ filter: "all" });
  assert.equal(p1.items.length, 40);
  assert.deepEqual([p1.total, p1.page, p1.pages, p1.page_size], [95, 1, 3, 40]);
  assert.equal(p1.counts.all, 95);
  const p3 = mia.rescueList({ filter: "all", page: 3 });
  assert.equal(p3.items.length, 15);
  const ids = new Set([...p1.items, ...mia.rescueList({ filter: "all", page: 2 }).items, ...p3.items].map(i => i.id));
  assert.equal(ids.size, 95, "sin repetidos ni faltantes entre páginas");
  assert.equal(mia.rescueList({ filter: "all", page: 9 }).page, 3);
  assert.equal(mia.rescueList({ filter: "all", page: 0 }).page, 1);
  assert.equal(mia.rescueList({ filter: "all", search: "Cliente 7" }).pages, 1);
});
