import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MiaConsole } from "../src/inspector/mia-console.js";
import { MemoryStore } from "../src/memory/memory-store.js";
import { InspectorEventStore } from "../src/inspector/event-store.js";
import { ChatwootApi } from "../src/chatwoot/api.js";

const at = iso => Math.floor(new Date(iso).getTime() / 1000);

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-export-"));
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"), 200);
  await memories.set(10, { nombre: "Silvia", telefono: "5512345678", curp: "XEXX010101HNEXXXA4", sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1" } });
  await memories.set(11, { nombre: "Prueba Axel" });
  await memories.set(12, { nombre: "Ayer" });
  const add = (id, timestamp, type, details) => { events.data[id] ||= []; events.data[id].push({ id: `${id}${timestamp}`, timestamp, type, details }); };
  add(10, "2026-10-20T15:00:30Z", "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola! Soy Mia de MARTCOM. ¿En qué te ayudo?", decision_source: "llm", replaced_reasons: ["curp_mention_guard"] });
  add(11, "2026-10-20T16:00:00Z", "ai_reply_sent", { customer_text: "test", reply: "ok", decision_source: "llm" });
  add(11, "2026-10-20T16:00:01Z", "lab.conversation_reset", {});
  add(12, "2026-10-19T16:00:00Z", "ai_reply_sent", { customer_text: "x", reply: "y", decision_source: "llm" });
  const chats = {
    10: [
      { id: 1, message_type: 0, content: "Hola", created_at: at("2026-10-20T15:00:00Z") },
      { id: 2, message_type: 1, content: "¡Hola! Soy Mia de MARTCOM. ¿En qué te ayudo?", created_at: at("2026-10-20T15:00:31Z") },
      { id: 3, message_type: 1, private: true, content: "nota interna", created_at: at("2026-10-20T15:01:00Z") },
      { id: 4, message_type: 1, content: "Te atiendo yo", sender: { name: "Pamela Montiel" }, created_at: at("2026-10-20T15:05:00Z") },
      { id: 5, message_type: 0, content: "", attachments: [{ file_type: "image" }], created_at: at("2026-10-20T15:06:00Z") },
    ],
  };
  const miaConsole = new MiaConsole({
    config: { ai: { timezone: "America/Mexico_City", schedule: "0-6=7-21" }, openai: { model: "gpt-5-mini" }, inspector: { adminToken: "x", testConversations: [11] } },
    memories, inspectorEvents: events,
    chatwoot: { async getAllMessages(id) { return { payload: chats[id] || [] }; } },
  });
  return { miaConsole };
}

test("exporta en un solo .txt las conversaciones del día, sin chats de prueba ni datos sensibles", async () => {
  const { miaConsole } = await setup();
  const result = await miaConsole.exportText({ from: "2026-10-20", to: "2026-10-20", now: new Date("2026-10-20T18:00:00Z") });
  assert.equal(result.count, 1);
  assert.equal(result.name, "mia-conversaciones-2026-10-20.txt");
  const t = result.text;
  assert.match(t, /Conversación 10 · Silvia/);
  assert.match(t, /\] CLIENTE:\nHola/);
  assert.match(t, /\] MIA \(IA\):\n¡Hola! Soy Mia de MARTCOM/);
  assert.match(t, /La IA había escrito otra cosa; se cambió porque:/);
  assert.match(t, /PERSONA · PAMELA MONTIEL:\nTe atiendo yo/);
  assert.match(t, /CLIENTE \[1 adjunto\(s\)\]:\n\(solo adjunto\)/);
  assert.doesNotMatch(t, /nota interna/);
  assert.doesNotMatch(t, /Prueba Axel|Conversación 12/);
  assert.doesNotMatch(t, /5512345678|XEXX010101HNEXXXA4/);
  assert.match(t, /\[20 oct, 09:00\]|\[20 oct 09:00\]|09:00/, "hora del centro de México");
});

test("rango de varios días y solo chats de prueba", async () => {
  const { miaConsole } = await setup();
  const both = await miaConsole.exportText({ from: "2026-10-19", to: "2026-10-20" });
  assert.equal(both.count, 2);
  assert.equal(both.name, "mia-conversaciones-2026-10-19_a_2026-10-20.txt");
  const tests = await miaConsole.exportText({ from: "2026-10-20", to: "2026-10-20", filter: "tests" });
  assert.equal(tests.count, 1);
  assert.match(tests.text, /Prueba Axel/);
});

test("Chatwoot: se juntan todas las páginas de mensajes, no solo las 20 más recientes", async () => {
  const api = new ChatwootApi({ baseUrl: "https://cw.test", accountId: 1, token: "t" });
  const all = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, created_at: i + 1, content: `m${i + 1}` }));
  const calls = [];
  api.getMessages = async (_id, { before } = {}) => {
    calls.push(before);
    const older = all.filter(m => !before || m.id < before);
    return { payload: older.slice(-20) };
  };
  const { payload } = await api.getAllMessages(5);
  assert.equal(payload.length, 45);
  assert.equal(payload[0].content, "m1");
  assert.deepEqual(calls, [null, 26, 6]);
});

test("el .txt dice por qué Mia no contestó (asignado a otra persona, una persona ya contestó…)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-export-"));
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"), 200);
  await memories.set(20, { nombre: "Cliente" });
  events.data[20] = [
    { id: "a", timestamp: "2026-10-20T15:50:05Z", type: "reassigned_skip", details: { assignee_name: "Pamela Montiel" } },
    { id: "b", timestamp: "2026-10-20T15:51:05Z", type: "human_replied_skip", details: {} },
  ];
  const miaConsole = new MiaConsole({
    config: { ai: { timezone: "America/Mexico_City" }, openai: {}, inspector: {} }, memories, inspectorEvents: events,
    chatwoot: { async getAllMessages() { return { payload: [{ id: 1, message_type: 0, content: "Para una consulta", created_at: at("2026-10-20T15:50:00Z") }] }; } },
  });
  const { text } = await miaConsole.exportText({ from: "2026-10-20" });
  assert.match(text, /CLIENTE:\nPara una consulta\n\n   \[[^\]]+\] ⚙ No respondió: el chat está asignado a otra persona \(asignado a Pamela Montiel\)/);
  assert.match(text, /⚙ No respondió: una persona del equipo ya había contestado/);
});
