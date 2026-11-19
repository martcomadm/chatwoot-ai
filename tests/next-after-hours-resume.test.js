import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { AfterHoursQueue, startAfterHoursResume } from "../src/core/after-hours-queue.js";
import { MessageBuffer } from "../src/core/message-buffer.js";
import { DEFAULT_SCHEDULE, outOfScheduleMessage, parseSchedule } from "../src/core/business-hours.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-after-hours-"));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const notice = outOfScheduleMessage(parseSchedule(DEFAULT_SCHEDULE));

test("la cola guarda los chats en disco y los entrega del más antiguo al más nuevo", () => {
  const file = path.join(tmp(), "q.json");
  const q = new AfterHoursQueue(file);
  q.add(20, ["b1"], new Date("2026-10-10T03:00:00Z"));
  q.add(10, ["a1"], new Date("2026-10-10T01:00:00Z"));
  q.add(10, ["a2", "a1"], new Date("2026-10-10T04:00:00Z"));
  const again = new AfterHoursQueue(file);
  assert.deepEqual(again.list().map(e => e.conversationId), [10, 20]);
  assert.deepEqual(again.list()[0].ids, ["a1", "a2"]);
  assert.deepEqual(again.take(10).ids, ["a1", "a2"]);
  assert.equal(again.take(10), null);
  assert.equal(new AfterHoursQueue(file).size(), 1);
});

test("al abrir se retoman uno por uno, con separación, y nada mientras está cerrado", async () => {
  const q = new AfterHoursQueue(path.join(tmp(), "q.json"));
  q.add(1, ["x"], new Date("2026-10-10T01:00:00Z"));
  q.add(2, ["y"], new Date("2026-10-10T02:00:00Z"));
  let open = false;
  const woken = [];
  const resume = startAfterHoursResume({ queue: q, isOpen: () => open, wake: id => { woken.push([id, Date.now()]); q.take(id); }, intervalMs: 60_000, spacingMs: 30, log: {} });
  try {
    assert.equal(await resume.drain(), 0);
    open = true;
    assert.equal(await resume.drain(), 2);
    assert.deepEqual(woken.map(w => w[0]), [1, 2]);
    assert.ok(woken[1][1] - woken[0][1] >= 25, "hay separación entre chats");
  } finally { resume.stop(); }
});

test("MessageBuffer.wake agenda un turno sin mensaje nuevo", async () => {
  const calls = [];
  const buffer = new MessageBuffer(5, async (id, snapshot) => calls.push([id, snapshot.ids, snapshot.sources]));
  buffer.wake(9, "after_hours_resume");
  await wait(30);
  assert.deepEqual(calls, [[9, [], ["after_hours_resume"]]]);
});

function harness({ extraMessages = [], status = "open" } = {}) {
  const state = { sent: [], events: [], processed: new Set(), merges: [] };
  const night = { id: 501, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quiero información", attachments: [], created_at: Date.parse("2026-10-10T04:00:00Z") / 1000 };
  const conversation = { id: 40, inbox_id: 7, status, meta: { assignee: { id: 53 } }, labels: ["sin_atender"], messages: [night, ...extraMessages] };
  const queue = new AfterHoursQueue(path.join(tmp(), "q.json"));
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { timezone: "America/Mexico_City", schedule: DEFAULT_SCHEDULE, assignedLabel: "asignado", unattendedLabel: "sin_atender", validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe(_id, add, remove) { state.merges.push({ add, remove }); return add; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: (_c, id) => state.processed.has(String(id)), async markProcessedMany(_c, ids) { ids.forEach(id => state.processed.add(String(id))); } },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    handoffRouter: {},
    workflow: null,
    afterHours: queue,
  });
  const snap = msg => ({ ids: [String(msg.id)], webhookMessages: new Map([[String(msg.id), msg]]) });
  return { state, processor, queue, night, snap };
}

test("de noche el chat entra a la cola; al abrir Mia lo retoma, saluda y pone 'asignado'", async () => {
  const { state, processor, queue, night, snap } = harness();
  processor.inSchedule = () => false;
  await processor.process(40, snap(night));
  assert.equal(queue.has(40), true);
  assert.equal(state.sent.length, 1, "solo el aviso de horario");
  assert.equal(state.merges.length, 0, "fuera de horario no se pone 'asignado'");

  processor.inSchedule = () => true;
  await processor.process(40, { ids: [], webhookMessages: new Map() });
  assert.equal(queue.has(40), false);
  assert.equal(state.sent.length, 2);
  assert.match(state.sent[1], /^¡Hola! Soy Mia de MARTCOM\. Gracias por tu paciencia\./);
  assert.deepEqual(state.merges[0], { add: ["asignado"], remove: ["sin_atender"] });
  assert.ok(state.processed.has("501"));
  assert.ok(state.events.some(e => e.type === "after_hours_resumed"));
});

test("si el cliente escribe al abrir, se contesta todo en un solo turno (sin respuesta doble)", async () => {
  const morning = { id: 502, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "¿Siguen ahí?", attachments: [] };
  const { state, processor, queue, night, snap } = harness({ extraMessages: [morning] });
  processor.inSchedule = () => false;
  await processor.process(40, snap(night));
  processor.inSchedule = () => true;
  await processor.process(40, snap(morning));
  await processor.process(40, { ids: [], webhookMessages: new Map() });
  assert.equal(state.sent.length, 2, "aviso + una sola respuesta");
  assert.ok(state.processed.has("501") && state.processed.has("502"));
  assert.equal(queue.size(), 0);
});

test("si una persona del equipo ya contestó de noche, Mia no retoma el chat", async () => {
  const human = { id: 600, message_type: 1, sender_type: "User", sender: { type: "user", id: 77 }, private: false, content: "Hola, te ayudo yo", created_at: Date.parse("2030-01-01T00:00:00Z") / 1000 };
  const { state, processor, night, snap } = harness({ extraMessages: [human] });
  processor.inSchedule = () => false;
  await processor.process(40, snap(night));
  processor.inSchedule = () => true;
  await processor.process(40, { ids: [], webhookMessages: new Map() });
  assert.equal(state.sent.length, 1, "solo el aviso");
  assert.ok(state.events.some(e => e.type === "after_hours_skipped" && e.data.reason === "human_replied"));
});

test("el aviso de horario que manda Mia no cuenta como respuesta humana", async () => {
  const miaNotice = { id: 601, message_type: 1, sender_type: "User", sender: { type: "user", id: 1 }, private: false, content: notice, created_at: Date.parse("2030-01-01T00:00:00Z") / 1000 };
  const { state, processor, night, snap } = harness({ extraMessages: [miaNotice] });
  processor.inSchedule = () => false;
  await processor.process(40, snap(night));
  processor.inSchedule = () => true;
  await processor.process(40, { ids: [], webhookMessages: new Map() });
  assert.equal(state.sent.length, 2);
});

test("un chat cerrado durante la noche no se retoma", async () => {
  const { state, processor, night, snap } = harness({ status: "resolved" });
  processor.inSchedule = () => false;
  await processor.process(40, snap(night));
  processor.inSchedule = () => true;
  await processor.process(40, { ids: [], webhookMessages: new Map() });
  assert.equal(state.sent.length, 1);
  assert.ok(state.events.some(e => e.type === "after_hours_skipped" && e.data.reason === "conversation_closed"));
});
