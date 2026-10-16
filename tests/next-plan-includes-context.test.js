import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

const plan1Memory = {
  presentacion_realizada: true,
  sales_cycle: { stage: "objection_handling", recommended_plan: "plan_1", authorized: false, price_objection_count: 1 },
  ultima_respuesta_agente: "Entiendo que el precio sea importante para ti. El costo informado para el Plan 1 es de $1,100 MXN. El precio es fijo y actualmente no manejamos descuentos. Si quieres, puedo explicarte qué incluye el plan para que puedas valorar si se ajusta a lo que necesitas.",
};

test("'explícame qué es lo que incluye' responde el plan en conversación, no el catálogo", () => {
  const result = orchestrateConversation("a ver explicame que es lo que incluye", plan1Memory);
  assert.equal(result.directRequest.plan, "plan_1");
  assert.match(result.directAnswer, /^El Plan 1/);
  assert.match(result.directAnswer, /medicamentos/);
  assert.match(result.directAnswer, /beneficiarios/);
  assert.doesNotMatch(result.directAnswer, /Tenemos dos opciones|Plan 2/);
});

test("con Plan 2 en conversación, 'qué incluye' explica el Plan 2", () => {
  const result = orchestrateConversation("¿y qué incluye?", { sales_cycle: { recommended_plan: "plan_2" } });
  assert.match(result.directAnswer, /^El Plan 2/);
  assert.match(result.directAnswer, /AFORE/);
});

test("preguntas de catálogo siguen mostrando ambos planes aunque haya plan en conversación", () => {
  for (const text of ["¿Qué planes tienen?", "¿Qué ofrecen?", "¿Cuál es la diferencia entre los planes?"]) {
    const result = orchestrateConversation(text, plan1Memory);
    assert.match(result.directAnswer, /Tenemos dos opciones/, text);
  }
});

test("sin plan en conversación, 'qué incluye' muestra ambos planes", () => {
  const result = orchestrateConversation("¿qué incluye?", {});
  assert.match(result.directAnswer, /Tenemos dos opciones/);
});

test("el número de plan explícito gana sobre el plan en conversación", () => {
  const result = orchestrateConversation("¿qué incluye el plan 2?", plan1Memory);
  assert.match(result.directAnswer, /^El Plan 2/);
});

test("conversación completa: tras la objeción de precio, Mia explica el Plan 1", async () => {
  const sent = [];
  let memory = structuredClone(plan1Memory);
  const message = { id: 901, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "a ver explicame que es lo que incluye", attachments: [] };
  const conversation = { id: 900, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion" }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() {} },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = structuredClone(next); }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: new Proxy({}, { get: () => async () => ({}) }),
    inspectorEvents: { async record() {} },
    handoffRouter: {},
    workflow: null,
  });
  await processor.process(900, { ids: ["901"], webhookMessages: new Map([["901", message]]) });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^El Plan 1 tiene un costo de \$1,100 MXN/);
  assert.doesNotMatch(sent[0], /Tenemos dos opciones/);
});

test("AFORE del Plan 2 es consistente: 5.5% y 10% alternado, nunca 5.15%", async () => {
  const { MARTCOM_KNOWLEDGE } = await import("../src/knowledge/martcom.js");
  const plan2 = orchestrateConversation("¿qué incluye el plan 2?", {}).directAnswer;
  const contributions = orchestrateConversation("¿cuánto aportan a la afore?", {}).directAnswer;
  for (const text of [MARTCOM_KNOWLEDGE, plan2, contributions]) {
    assert.match(text, /5\.5%/);
    assert.match(text, /10%/);
    assert.doesNotMatch(text, /5\.15/);
  }
});
