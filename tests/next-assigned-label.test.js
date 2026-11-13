import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

function harness({ labels = [], assignee = 53 } = {}) {
  const state = { merges: [], sent: [], events: [] };
  const message = { id: 300, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quiero información", attachments: [] };
  const conversation = { id: 12, inbox_id: 7, meta: { assignee: assignee ? { id: assignee } : null }, labels, messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { assignedLabel: "asignado", unattendedLabel: "sin_atender", validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe(_id, add, remove) { state.merges.push({ add, remove }); return [...labels.filter(l => !remove.includes(l)), ...add]; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    handoffRouter: {},
    workflow: null,
  });
  const run = () => processor.process(12, { ids: ["300"], webhookMessages: new Map([["300", message]]) });
  return { state, run };
}

test("al recibir el chat Mia pone 'asignado' y quita 'sin_atender'", async () => {
  const { state, run } = harness({ labels: ["sin_atender"] });
  await run();
  assert.deepEqual(state.merges[0], { add: ["asignado"], remove: ["sin_atender"] });
  assert.ok(state.events.some(e => e.type === "assigned_label_applied"));
});

test("si el chat ya tiene 'asignado' no vuelve a tocar las etiquetas por eso", async () => {
  const { state, run } = harness({ labels: ["asignado"] });
  await run();
  assert.equal(state.merges.filter(m => m.add.includes("asignado")).length, 0);
});

test("un chat reasignado a otra persona no recibe la etiqueta de Mia", async () => {
  const { state, run } = harness({ labels: [], assignee: 99 });
  await run();
  assert.equal(state.merges.length, 0);
});

test("con Mia pausada por etiqueta no se agrega 'asignado'", async () => {
  const { state, run } = harness({ labels: ["pausar_mia"] });
  await run();
  assert.equal(state.merges.length, 0);
});
