import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SelfSenders } from "../src/core/self-senders.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { AfterHoursQueue } from "../src/core/after-hours-queue.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-self-"));

test("aprende la cuenta con la que Mia publica y la recuerda tras reiniciar", async () => {
  const file = path.join(tmp(), "self.json");
  const registry = new SelfSenders(file, [53]);
  const chatwoot = registry.wrap({ async sendMessage() { return { id: 1, sender: { id: 88, type: "user" } }; } });
  await chatwoot.sendMessage(1, "hola");
  assert.equal(new SelfSenders(file).isOwn({ sender_id: 88 }), true);
  assert.equal(registry.isOwn({ sender: { id: 53 } }), true);
  assert.equal(registry.isOwn({ sender: { id: 77 }, content: "Te atiendo yo" }), false);
});

test("un aviso de horario viejo (de antes de cambiar el horario) sigue contando como de Mia", () => {
  const registry = new SelfSenders();
  assert.equal(registry.isOwn({ sender: { id: 99 }, content: "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de lunes a viernes de 7:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m. Recibimos tu mensaje y te respondemos en cuanto abramos." }), true);
});

// Caso real 13-oct: los chats de la noche no se retomaron porque el aviso se mandó con el
// horario anterior (y desde otra cuenta), y Mia lo tomó como respuesta de una persona.
test("al abrir se retoma el chat aunque el aviso de la noche tenga el horario anterior", async () => {
  const sent = [];
  const events = [];
  const night = { id: 701, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quiero información", attachments: [], created_at: Date.parse("2026-10-13T03:00:00Z") / 1000 };
  const oldNotice = { id: 702, message_type: 1, sender_type: "User", sender: { type: "user", id: 99 }, private: false, content: "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de lunes a viernes de 7:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m. Recibimos tu mensaje y te respondemos en cuanto abramos.", created_at: Date.parse("2026-10-13T03:00:05Z") / 1000 };
  const conversation = { id: 50, inbox_id: 7, status: "open", meta: { assignee: { id: 53 } }, labels: [], messages: [night, oldNotice] };
  const queue = new AfterHoursQueue(path.join(tmp(), "q.json"));
  queue.add(50, ["701"], new Date("2026-10-13T03:00:00Z"));
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { timezone: "America/Mexico_City", schedule: "1-5=7-21;6=10-15", validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, data) { events.push({ type, data }); } },
    handoffRouter: {}, workflow: null, afterHours: queue,
  });
  processor.inSchedule = () => true;
  await processor.process(50, { ids: [], webhookMessages: new Map() });
  assert.ok(!events.some(e => e.type === "after_hours_skipped"), JSON.stringify(events.map(e => e.type)));
  assert.ok(events.some(e => e.type === "after_hours_resumed"));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Gracias por tu paciencia/);
});
