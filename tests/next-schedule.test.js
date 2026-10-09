import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { TurnLock } from "../src/core/turn-lock.js";
import { DEFAULT_SCHEDULE, parseSchedule, isOpen, nextOpeningDate, describeSchedule, outOfScheduleMessage } from "../src/core/business-hours.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Hora local de Ciudad de México (UTC-6, sin horario de verano).
// 2026-10-12 es lunes, 2026-10-17 sábado y 2026-10-18 domingo.
const mx = (date, hour, minute = 15) => new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-06:00`);
const week = parseSchedule(DEFAULT_SCHEDULE);
const TZ = "America/Mexico_City";

test("lunes a viernes: abierto de 9:00 a 17:59", () => {
  assert.equal(isOpen(week, mx("2026-10-12", 8, 59), TZ), false);
  assert.equal(isOpen(week, mx("2026-10-12", 9, 0), TZ), true);
  assert.equal(isOpen(week, mx("2026-10-16", 17, 59), TZ), true);
  assert.equal(isOpen(week, mx("2026-10-16", 18, 0), TZ), false);
});

test("sábado: abierto de 10:00 a 14:59", () => {
  assert.equal(isOpen(week, mx("2026-10-17", 9, 30), TZ), false);
  assert.equal(isOpen(week, mx("2026-10-17", 10, 0), TZ), true);
  assert.equal(isOpen(week, mx("2026-10-17", 14, 59), TZ), true);
  assert.equal(isOpen(week, mx("2026-10-17", 15, 0), TZ), false);
});

test("domingo: sin servicio todo el día", () => {
  for (const hour of [0, 9, 12, 17, 23]) assert.equal(isOpen(week, mx("2026-10-18", hour), TZ), false);
});

test("la siguiente apertura se calcula bien al cerrar el sábado y en domingo", () => {
  assert.equal(nextOpeningDate(week, mx("2026-10-12", 20), TZ), "2026-10-13");
  assert.equal(nextOpeningDate(week, mx("2026-10-13", 2), TZ), "2026-10-13");
  assert.equal(nextOpeningDate(week, mx("2026-10-16", 19), TZ), "2026-10-17");
  assert.equal(nextOpeningDate(week, mx("2026-10-17", 16), TZ), "2026-10-19");
  assert.equal(nextOpeningDate(week, mx("2026-10-18", 12), TZ), "2026-10-19");
});

test("el horario se describe en español claro", () => {
  assert.equal(describeSchedule(week), "lunes a viernes de 9:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m.");
  assert.equal(outOfScheduleMessage(week), "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de lunes a viernes de 9:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m. Recibimos tu mensaje y te respondemos en cuanto abramos.");
});

test("un AI_SCHEDULE mal escrito se rechaza", () => {
  assert.throws(() => parseSchedule("1-5=18-9"));
  assert.throws(() => parseSchedule("8=9-18"));
  assert.throws(() => parseSchedule("lunes=9-18"));
});

function harness(schedule = DEFAULT_SCHEDULE) {
  const state = { sent: [], events: [], processed: new Set() };
  const message = { id: 90, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quiero información", attachments: [] };
  const conversation = { id: 8, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-schedule-"));
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { timezone: TZ, schedule, validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
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

test("sin horario configurado Mia siempre atiende", () => {
  const { processor } = harness(null);
  assert.equal(processor.inSchedule(mx("2026-10-18", 3)), true);
});

test("fuera de horario Mia avisa una sola vez y no contesta ni marca los mensajes", async () => {
  const { processor, state, snapshot } = harness();
  processor.inSchedule = () => false;
  await processor.process(8, snapshot(90));
  await processor.process(8, snapshot(91));
  assert.equal(state.sent.length, 1, "solo un aviso por periodo cerrado");
  assert.match(state.sent[0], /sábado de 10:00 a\.m\. a 3:00 p\.m\./);
  assert.equal(state.processed.size, 0, "los mensajes quedan sin marcar para el equipo");
  assert.deepEqual(state.events.map(e => e.type), ["ignored_out_of_schedule", "ignored_out_of_schedule"]);
  assert.equal(state.events[1].data.notice_sent, false);
});

test("sábado en la tarde y domingo cuentan como un solo periodo cerrado (un aviso)", async () => {
  const { processor } = harness();
  const sent = [];
  processor.chatwoot.sendMessage = async (_id, text) => sent.push(text);
  await processor.notifyOutOfSchedule(8, ["1"], mx("2026-10-17", 16));
  await processor.notifyOutOfSchedule(8, ["2"], mx("2026-10-18", 11));
  await processor.notifyOutOfSchedule(8, ["3"], mx("2026-10-19", 7));
  assert.equal(sent.length, 1);
});

test("la base de conocimiento incluye el horario de atención", () => {
  assert.match(MARTCOM_KNOWLEDGE, /lunes a viernes de 9:00 a\.m\. a 6:00 p\.m\. y sábado de 10:00 a\.m\. a 3:00 p\.m\. Los domingos no hay servicio/);
});
