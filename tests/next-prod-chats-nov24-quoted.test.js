import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { priceObjectionDecision } from "../src/sales/progressive-disclosure.js";

// Chatwoot entrega en GET /conversations/:id solo el último mensaje; los anteriores vienen en /messages.
function processorWith(messages, memory) {
  const sent = []; const events = [];
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: {
      async getConversation() { return { id: 90, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [structuredClone(messages.at(-1))] }; },
      async getMessages() { return { payload: structuredClone(messages) }; },
      async sendMessage(_i, t, priv) { if (!priv) sent.push(t); },
    },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_i, n) { memory = n; }, async merge(_i, patch) { memory = { ...memory, ...patch }; }, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "«LLM»" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } },
  });
  return { p, sent, events, mem: () => memory };
}

test("#12146: 'Sí, por favor' citando '¿Quieres que te explique cómo funciona?' no abre el expediente", async () => {
  const now = Math.floor(Date.now() / 1000);
  const explainOffer = "¡Hola! Soy Mia de MARTCOM. Gracias por tu paciencia. Entiendo. Si tu prioridad es continuar cotizando semanas, el Plan 1 puede ajustarse a lo que buscas. Tiene un costo de $1,100 MXN mensuales e incluye continuación de semanas y servicio médico del IMSS. ¿Quieres que te explique cómo funciona?";
  const startAsk = "Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el Plan 1? Si tienes alguna duda, con gusto te la resuelvo.";
  const messages = [
    { id: 10, message_type: 1, content: explainOffer, created_at: now - 16000, sender_type: "User", sender: { id: 53, type: "user" } },
    { id: 11, message_type: 1, content: "¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo.", created_at: now - 15000, sender_type: "User", sender: { id: 53, type: "user" } },
    { id: 12, message_type: 1, content: startAsk, created_at: now - 5000, sender_type: "User", sender: { id: 53, type: "user" } },
    { id: 13, message_type: 0, content: "Si por favor", content_attributes: { in_reply_to: 10 }, created_at: now - 60, sender_type: "Contact", sender: { type: "contact" } },
  ];
  const memory = { presentacion_realizada: true, tiene_imss: false, commercial_need: { weeks: true }, sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", pitched_plans: ["plan_1"] }, ultima_respuesta_agente: startAsk };
  const { p, sent, mem, events } = processorWith(messages, memory);
  await p.process(90, { ids: ["13"], webhookMessages: new Map([["13", messages[3]]]) });
  assert.doesNotMatch(sent.join(" "), /compárteme por favor la CURP/, "no pide la CURP");
  assert.match(sent.join(" "), /El Plan 1 incluye/, "le explica el plan, que es lo que aceptó");
  assert.notEqual(mem().sales_cycle?.authorized, true);
});

test("13-nov: 'Me explica qué contiene el plan uno, que cuesta $1100, el otro rebasa mi presupuesto' no es objeción de precio", () => {
  const mem = { sales_cycle: { recommended_plan: "plan_2", pitched_plans: ["plan_2"] } };
  assert.equal(priceObjectionDecision(mem, "me explica que contiene el plan uno , que cuesta $1100 el otro rebasa mi presupuesto"), null);
  assert.ok(priceObjectionDecision(mem, "Está muy caro, no me alcanza"), "la objeción normal se sigue atendiendo");
});
