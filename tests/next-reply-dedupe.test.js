import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

function setup(history = []) {
  const calls = { sent: [], events: [] };
  let memory = {};
  const message = { id: 801, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "hola", attachments: [] };
  const conversation = { id: 900, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion" }, operations: {} },
    chatwoot: {
      async getConversation() { return structuredClone(conversation); },
      async sendMessage(_id, text) { calls.sent.push(text); },
      async getMessages() { return { payload: history }; },
    },
    labels: { async mergeSafe() {} },
    memories: {
      get: () => structuredClone(memory), async set(_id, next) { memory = structuredClone(next); }, async merge() {},
      hasProcessed: () => false, async markProcessedMany() {},
    },
    agentRotation: {},
    ai: new Proxy({}, { get: () => async () => ({}) }),
    inspectorEvents: { async record(_id, type, data) { calls.events.push({ type, data }); } },
    handoffRouter: {},
    workflow: null,
  });
  return { processor, calls, snapshot: { ids: ["801"], webhookMessages: new Map([["801", message]]) } };
}

test("la respuesta enviada registra su fuente en el Inspector", async () => {
  const { processor, calls, snapshot } = setup();
  await processor.process(900, snapshot);
  assert.equal(calls.sent.length, 1);
  const sent = calls.events.find(event => event.type === "ai_reply_sent");
  assert.ok(sent, "debe registrar ai_reply_sent");
  assert.ok(sent.data.decision_source, "decision_source no debe quedar vacío");
  assert.notEqual(sent.data.decision_source, "unknown");
});

test("deduplicación ignora diferencias de espacios y saltos de línea", async () => {
  const first = setup();
  await first.processor.process(900, first.snapshot);
  const reply = first.calls.sent[0];
  const spaced = reply.replace(/ /g, "   ").replace(/\. /g, ".\n\n");
  const second = setup([{ id: 1, message_type: 1, private: false, content: spaced, created_at: Math.floor(Date.now() / 1000) }]);
  await second.processor.process(900, second.snapshot);
  assert.deepEqual(second.calls.sent, []);
  assert.ok(second.calls.events.some(event => event.type === "duplicate_reply_suppressed"));
});
