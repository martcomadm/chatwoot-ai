import test from "node:test";
import assert from "node:assert/strict";
import { analyzeJudgment, controlledAnswer, detectQuestion } from "../src/orchestrator/conversational-judgment.js";
import { orchestrateConversation, OPERATIONAL_MODEL_ANSWER } from "../src/orchestrator/conversation-orchestrator.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

async function converse(turns) {
  let memory = { presentacion_realizada: true, ultima_respuesta_agente: "Hola" };
  const sent = [];
  const handoffs = [];
  let id = 1;
  for (const content of turns) {
    const message = { id: id++, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [] };
    const conversation = { id: 9, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
    await new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "v", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_i, text, isPrivate) { if (!isPrivate) sent.push(text); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(memory), async set(_i, next) { memory = structuredClone(next); }, async merge(_i, patch) { memory = { ...memory, ...patch }; }, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {},
      ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "respuesta de IA", question_key: null }), repairDecision: async () => ({ reply: "respuesta de IA" }), handoffSummary: async () => "resumen" },
      inspectorEvents: { async record(_i, type, data) { if (type === "handoff") handoffs.push(data.reason); } },
      handoffRouter: { async route() { return {}; } },
      workflow: null,
    }).process(9, { ids: [String(message.id)], webhookMessages: new Map([[String(message.id), message]]) });
  }
  return { sent, handoffs };
}

test("un cliente que compara precios varias veces nunca es transferido", async () => {
  const { sent, handoffs } = await converse(["¿cuánto sale aproximadamente?", "¿cuánto cuesta el plan 1?", "¿y el precio del plan 2?", "pero cuánto es el costo?"]);
  assert.deepEqual(handoffs, []);
  assert.equal(sent.length, 4);
  for (const reply of sent) assert.match(reply, /\$1,[15]00 MXN/);
});

test("las respuestas del motor de juicio usan los precios oficiales, nunca 'el costo depende'", () => {
  for (const key of ["price", "services", "services_plan_1", "services_plan_2"]) {
    const answer = controlledAnswer(key, { intent: { id: "COTIZACION_SEMANAS" } });
    assert.doesNotMatch(answer, /depende|no quiero darte una cifra/i, key);
  }
  assert.match(controlledAnswer("price"), /\$1,100 MXN mensuales/);
  assert.match(controlledAnswer("price"), /\$1,500 MXN mensuales/);
  assert.equal(analyzeJudgment("cuanto cuesta aproximadamente", {}).directAnswer, controlledAnswer("price"));
});

test("pedir el precio antes de dar datos se responde, no se transfiere", () => {
  const judgment = analyzeJudgment("antes de compartir mis datos quiero saber cuánto cuesta", {});
  assert.equal(judgment.shouldHandoff, false);
  assert.match(judgment.directAnswer, /\$1,100/);
});

test("pedir hablar con una persona sigue transfiriendo", () => {
  assert.equal(analyzeJudgment("prefiero atención personal", {}).shouldHandoff, true);
});

test("'¿es mensual?' se responde con la frecuencia y los dos precios", () => {
  for (const text of ["¿es mensual?", "¿cuánto es al mes?", "¿es un solo pago o cada mes?", "cada cuánto se paga?"]) {
    const { directRequest, directAnswer } = orchestrateConversation(text, {});
    assert.equal(directRequest?.type, "payment_frequency", text);
    assert.match(directAnswer, /mensual/);
    assert.match(directAnswer, /\$1,100 MXN al mes/);
  }
});

test("'¿me dan de alta con una empresa?' se responde con el modelo oficial, sin transferir", async () => {
  for (const text of ["¿me dan de alta con una empresa?", "con qué empresa quedo registrado?", "quién sería mi patrón?"]) {
    assert.equal(detectQuestion(text)?.type, "operational_model", text);
  }
  const { sent, handoffs } = await converse(["¿me dan de alta con una empresa?"]);
  assert.deepEqual(handoffs, []);
  assert.deepEqual(sent, [OPERATIONAL_MODEL_ANSWER]);
  assert.match(OPERATIONAL_MODEL_ANSWER, /empresa de respaldo/);
  assert.match(OPERATIONAL_MODEL_ANSWER, /pago mensual en tiempo y forma/);
});

test("la base de conocimiento de Mia dice que el pago es mensual y cómo es el alta", () => {
  assert.match(MARTCOM_KNOWLEDGE, /PLAN 1 — \$1,100 MXN mensuales/);
  assert.match(MARTCOM_KNOWLEDGE, /PLAN 2 — \$1,500 MXN mensuales/);
  assert.match(MARTCOM_KNOWLEDGE, /empresa de respaldo/);
  assert.doesNotMatch(MARTCOM_KNOWLEDGE, /periodicidad de cobro/);
});
