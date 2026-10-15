import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { detectDeferral } from "../src/sales/customer-deferral.js";
import { contextualNextStep } from "../src/core/fallback.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// Revisión de los chats reales del 14 y 15 de octubre.

test("preguntas reales del 14-15 oct reciben respuesta directa", () => {
  const cases = {
    "Es a través de alguna modalidad o como es": "modality",
    "Dónde te ubicas?": "location",
    "No sé qué plan ofrecen": "services",
    "Que plan ofrecen?": "services",
  };
  for (const [text, type] of Object.entries(cases)) {
    assert.equal(detectDirectRequest(text, {})?.type, type, text);
  }
});

test("'deje reviso' y 'lo reviso' cuentan como posponer: no se insiste ni se da seguimiento", () => {
  assert.equal(detectDeferral("Gicela, pero deje reviso, gracias"), "later");
  assert.equal(detectDeferral("ok lo reviso"), "later");
  assert.equal(detectDeferral("voy a revisar y le digo"), "later");
  assert.equal(detectDeferral("¿lo reviso yo o ustedes?"), null);
});

test("con el plan identificado pero sin explicar, el respaldo ofrece explicarlo (no '¿algo más?')", () => {
  const memory = { commercial_need: { service_medical: true }, ultima_respuesta_agente: "¿Hay algo más en lo que te pueda ayudar?" };
  assert.match(contextualNextStep(memory), /Plan 1 es el que mejor se ajusta.*explique cómo funciona/);
});

const msg = (id, content, extra = {}) => ({ id, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: id, ...extra });

test("chat retomado: si la conversación no trae el mensaje del cliente, se busca en la lista de mensajes y se contesta", async () => {
  const notice = { id: 901, message_type: 1, private: false, content: "¡Gracias por escribir a MARTCOM! Nuestro horario de atención es…", created_at: 901, sender: { type: "user", id: 53 } };
  const customer = msg(900, "NO cuento con IMSS y quiero afiliarme.");
  const sent = [];
  const conversation = { id: 71, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [notice] };
  let memory = { presentacion_realizada: true, ultima_respuesta_agente: "x" };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [customer, notice] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Claro, con gusto te ayudo a afiliarte. ¿A qué te dedicas actualmente?", question_key: "actividad" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} },
    handoffRouter: {}, workflow: null,
  });
  await processor.process(71, { ids: ["900"], webhookMessages: new Map(), force: true });
  assert.equal(sent.length, 1, `se enviaron: ${JSON.stringify(sent)}`);
});

test("Griselda (14-oct): necesidad sin IA, 'más información' tras otra duda y seguimientos con su plan", async () => {
  const { followUpMessage } = await import("../src/core/follow-up.js");
  const { contextualPlanExplanation } = await import("../src/sales/progressive-disclosure.js");
  const { fallbackDecision } = await import("../src/core/fallback.js");
  const memory = { commercial_need: { weeks: true, retirement: true }, sales_cycle: { pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "Tu alta se realiza con una empresa…" };
  assert.match(contextualPlanExplanation(memory, "Podría darme más información")?.reply || "", /El Plan 1 incluye/);
  assert.equal(contextualPlanExplanation({ ...memory, sales_cycle: { pitched_plans: ["plan_1"], explained_plans: ["plan_1"] } }, "Podría darme más información"), null);
  assert.match(followUpMessage({ commercial_need: { retirement: true } }, 0), /Plan 1/);
  const fb = fallbackDecision(memory, { question_key: "necesidad_principal" }, "44");
  assert.doesNotMatch(fb.reply, /Qué te interesa principalmente/);
});

test("la necesidad del cliente se guarda aunque falle la extracción con IA", async () => {
  const sent = [];
  let memory = { presentacion_realizada: true, ultima_respuesta_agente: "x" };
  const m = msg(960, "Dejé de cotizar, quiero seguir sumando para pensionarme");
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 73, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => { throw new Error("timeout"); }, generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null,
  });
  await processor.process(73, { ids: ["960"], webhookMessages: new Map([["960", m]]) });
  assert.equal(memory.commercial_need?.weeks, true);
  assert.equal(memory.commercial_need?.retirement, true);
});
