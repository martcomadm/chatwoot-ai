import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pendingFromMessages, PendingSweep } from "../src/core/pending-sweep.js";
import { SelfSenders } from "../src/core/self-senders.js";
import { AfterHoursQueue } from "../src/core/after-hours-queue.js";
import { TurnLock } from "../src/core/turn-lock.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

const NOW = Date.parse("2026-10-13T18:40:00Z"); // martes 12:40 p.m. CDMX
const s = ms => Math.floor(ms / 1000);
const H = 3600 * 1000;
const NOTICE = "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de lunes a viernes de 9:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m. Recibimos tu mensaje y te respondemos en cuanto abramos.";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-sweep-"));
const self = new SelfSenders(null, [53, 88]);
const customer = (id, ago, content = "Hola, quiero información") => ({ id, message_type: 0, private: false, content, created_at: s(NOW - ago), sender_type: "Contact" });
const mia = (id, ago, content) => ({ id, message_type: 1, private: false, content, created_at: s(NOW - ago), sender_type: "User", sender: { id: 88, type: "user" } });
const human = (id, ago, content) => ({ id, message_type: 1, private: false, content, created_at: s(NOW - ago), sender_type: "User", sender: { id: 7, type: "user" } });

// Caso real 13-oct: varios chats (Angeltec, Elsa, Gice, Viridiana…) quedaron solo con el aviso.
test("detecta chats que se quedaron solo con el aviso de horario", () => {
  const p = pendingFromMessages([customer(1, 10 * H), mia(2, 10 * H - 5000, NOTICE)], { selfSenders: self, now: NOW });
  assert.equal(p.kind, "after_hours_notice");
  assert.deepEqual(p.ids, ["1"]);
});

test("detecta un mensaje del cliente sin respuesta, pero no uno recién llegado", () => {
  assert.equal(pendingFromMessages([mia(1, 2 * H, "¿Cuentas con IMSS?"), customer(2, 30 * 60 * 1000, "no")], { selfSenders: self, now: NOW }).kind, "unanswered");
  assert.equal(pendingFromMessages([mia(1, 2 * H, "¿Cuentas con IMSS?"), customer(2, 60 * 1000, "no")], { selfSenders: self, now: NOW }), null);
});

test("no toca chats ya contestados, atendidos por una persona o fuera de la ventana de 24 h", () => {
  assert.equal(pendingFromMessages([customer(1, 3 * H), mia(2, 3 * H - 1000, "¡Hola! Soy Mia…")], { selfSenders: self, now: NOW }), null);
  assert.equal(pendingFromMessages([customer(1, 3 * H), human(2, 2 * H, "Te atiendo yo"), customer(3, H, "gracias")], { selfSenders: self, now: NOW }), null);
  assert.equal(pendingFromMessages([customer(1, 25 * H), mia(2, 25 * H - 5000, NOTICE)], { selfSenders: self, now: NOW }), null);
});

function sweepWith(conversations, { processed = new Set(), open = true } = {}) {
  const woken = [];
  const queue = new AfterHoursQueue(path.join(tmp(), "q.json"));
  const sweep = new PendingSweep({
    chatwoot: {
      async listConversations() { return { data: { payload: conversations.map(c => ({ id: c.id, inbox_id: c.inbox ?? 7, meta: { assignee: { id: c.assignee ?? 53 } } })) } }; },
      async getMessages(id) { return { payload: conversations.find(c => c.id === id).messages }; },
    },
    config: { chatwoot: { inboxId: 7, agentId: 53 } },
    afterHours: queue, memories: { hasProcessed: (_c, mid) => processed.has(String(mid)) }, selfSenders: self,
    turnLock: new TurnLock(path.join(tmp(), "locks")), wake: id => woken.push(id), isOpen: () => open,
  });
  return { sweep, woken, queue };
}

test("el rescate retoma los chats con aviso (aunque estén marcados como procesados) una sola vez", async () => {
  const convs = [
    { id: 10, messages: [customer(1, 4 * H), mia(2, 4 * H - 5000, NOTICE)] },
    { id: 11, messages: [customer(3, 16 * H), mia(4, 16 * H - 5000, NOTICE)] },
    { id: 12, messages: [customer(5, 3 * H), mia(6, 3 * H - 1000, "¡Hola! Soy Mia…")] },
    { id: 13, assignee: 99, messages: [customer(7, 4 * H), mia(8, 4 * H - 5000, NOTICE)] },
  ];
  const { sweep, woken, queue } = sweepWith(convs, { processed: new Set(["1", "3"]) });
  assert.equal((await sweep.run(NOW)).resumed, 2);
  assert.deepEqual(woken, [10, 11]);
  assert.equal(queue.list().find(e => e.conversationId === 10).force, true);
  queue.take(10); queue.take(11);
  assert.equal((await sweep.run(NOW)).resumed, 0, "no reintenta el mismo mensaje");
});

test("el rescate no corre fuera de horario", async () => {
  const { sweep, woken } = sweepWith([{ id: 10, messages: [customer(1, 4 * H), mia(2, 4 * H - 5000, NOTICE)] }], { open: false });
  await sweep.run(NOW);
  assert.equal(woken.length, 0);
});

test("en el processor, el chat rescatado se contesta aunque el mensaje figure como procesado", async () => {
  const sent = [];
  const night = { ...customer(1, 4 * H), sender: { type: "contact" }, attachments: [] };
  const conversation = { id: 10, inbox_id: 7, status: "open", meta: { assignee: { id: 53 } }, labels: [], messages: [night, mia(2, 4 * H - 5000, NOTICE)] };
  const queue = new AfterHoursQueue(path.join(tmp(), "q.json"));
  queue.add(10, ["1"], new Date(NOW - 4 * H), { force: true });
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => true, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} },
    handoffRouter: {}, workflow: null, afterHours: queue, selfSenders: self,
  });
  await processor.process(10, { ids: [], webhookMessages: new Map() });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^¡Hola! Soy Mia de MARTCOM\. Gracias por tu paciencia\./);
});
