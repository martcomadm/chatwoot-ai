import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationProcessor, outOfScheduleMessage } from "../src/core/conversation-processor.js";
import { TurnLock } from "../src/core/turn-lock.js";
import { MARTCOM_KNOWLEDGE as KNOWLEDGE } from "../src/knowledge/martcom.js";

// Hora local de Ciudad de México (UTC-6, sin horario de verano).
const mx = (date, hour) => new Date(`${date}T${String(hour).padStart(2, "0")}:15:00-06:00`);

function harness({ startHour = 9, endHour = 18 } = {}) {
  const state = { sent: [], events: [], processed: new Set() };
  const message = { id: 90, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quiero información", attachments: [] };
  const conversation = { id: 8, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-schedule-"));
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { timezone: "America/Mexico_City", startHour, endHour, validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: (_c, id) => state.processed.has(String(id)), async markProcessedMany(_c, ids) { ids.forEach(id => state.processed.add(String(id))); } },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    handoffRouter: {},
    workflow: null,
    turnLock: new TurnLock(dir),
  });
  const snapshot = id => ({ ids: [String(id)], webhookMessages: new Map([[String(id), { ...message, id }]]) });
  return { processor, state, snapshot };
}

test("horario de atención: abierto de 9:00 a 17:59, cerrado a las 18:00 y antes de las 9:00", () => {
  const { processor } = harness();
  assert.equal(processor.inSchedule(mx("2026-10-12", 8)), false);
  assert.equal(processor.inSchedule(mx("2026-10-12", 9)), true);
  assert.equal(processor.inSchedule(mx("2026-10-12", 17)), true);
  assert.equal(processor.inSchedule(mx("2026-10-12", 18)), false);
  assert.equal(processor.inSchedule(mx("2026-10-12", 23)), false);
});

test("sin horas configuradas Mia siempre atiende", () => {
  const { processor } = harness({ startHour: null, endHour: null });
  assert.equal(processor.inSchedule(mx("2026-10-12", 3)), true);
});

test("fuera de horario Mia avisa una sola vez y no contesta ni marca los mensajes", async () => {
  const { processor, state, snapshot } = harness();
  processor.inSchedule = () => false;
  await processor.process(8, snapshot(90));
  await processor.process(8, snapshot(91));
  assert.equal(state.sent.length, 1, "solo un aviso por periodo cerrado");
  assert.match(state.sent[0], /9:00 a\.m\. a 6:00 p\.m\./);
  assert.equal(state.processed.size, 0, "los mensajes quedan sin marcar para el equipo");
  assert.deepEqual(state.events.map(e => e.type), ["ignored_out_of_schedule", "ignored_out_of_schedule"]);
  assert.equal(state.events[1].data.notice_sent, false);
});

test("el aviso de fuera de horario usa las horas configuradas", () => {
  assert.equal(outOfScheduleMessage({ startHour: 9, endHour: 18 }), "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de 9:00 a.m. a 6:00 p.m. Recibimos tu mensaje y te respondemos en cuanto abramos.");
});

test("la base de conocimiento incluye el horario de atención", () => {
  assert.match(String(KNOWLEDGE), /9:00 a\.m\. a 6:00 p\.m\./);
});
