import test from "node:test";
import assert from "node:assert/strict";
import { detectDeferral, detectClosing, deferralDecision } from "../src/sales/customer-deferral.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// Chat real del 9-oct (María Esther, 57 años, ama de casa, Plan 1): quería el plan pero
// no tenía dinero; Mia siguió insistiendo, contestó "¿Me compartes un poco más sobre tu
// situación?" a un "Sí, ok, gracias" y entendió "No, todo bien. Gracias" como un problema.

test("frases reales de 'ahorita no tengo dinero' se reconocen", () => {
  for (const text of [
    "Si quiero pero por el momento no cuánto con dinero",
    "Es que yo los jueves boy y alzó una casa y pues ahorita no cuánto con dinero",
    "Si pero pues por el momento no tengo ahorita la forma de pagar",
    "ahorita no tengo dinero",
  ]) assert.equal(detectDeferral(text), "no_money", text);
});

test("frases reales de 'yo le aviso' se reconocen", () => {
  for (const text of ["Y cuando yo pueda pagar yo los contacto", "Ok yo le aviso cuando si gracias", "A ok muy bien yo le aviso", "lo voy a pensar"]) {
    assert.equal(detectDeferral(text), "later", text);
  }
});

test("agradecimientos y 'no, todo bien' son cierre, no un problema", () => {
  for (const text of ["No todo bien\nGracias", "A ok muchas gracias", "Si ok gracias", "gracias"]) assert.equal(detectClosing(text), true, text);
  for (const text of ["Si está bien", "ok", "gracias, ¿y qué documentos necesito?", "no tengo IMSS"]) assert.equal(detectClosing(text), false, text);
});

test("'sí quiero pero no tengo dinero' no autoriza el trámite", () => {
  const memory = { sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1" }, ultima_respuesta_agente: "Listo. Puedo iniciar tu trámite con el Plan 1 ($1,100 MXN/mes). ¿Deseas que proceda a preparar el alta ahora?" };
  assert.equal(analyzeNextSale("Si quiero pero por el momento no cuánto con dinero", memory).authorized, false);
  assert.equal(commitmentDecision(memory, "Si quiero pero por el momento no cuánto con dinero"), null);
});

test("respuestas: empática sin insistir, y no repite la despedida", () => {
  const memory = { nombre: "Maria Esther Granados Ortiz", sales_cycle: { recommended_plan: "plan_1" } };
  const money = deferralDecision(memory, "ahorita no cuánto con dinero");
  assert.equal(money.reply, "Entiendo, Maria, no te preocupes. Cuando tengas la posibilidad, escríbeme por aquí y con gusto retomamos tu trámite con el Plan 1. Aquí estaré para ayudarte.");
  assert.doesNotMatch(money.reply, /\$|documentos|¿/);
  const thanks = deferralDecision(memory, "A ok muchas gracias");
  assert.match(thanks.reply, /^Con gusto, Maria\. Quedo al pendiente/);
  const again = deferralDecision({ ...memory, ultima_respuesta_agente: money.reply }, "Ok yo le aviso cuando si gracias");
  assert.equal(again.reply, "", "si Mia ya se despidió, no vuelve a contestar");
});

test("en el processor: se despide, no programa seguimientos y cancela los pendientes", async () => {
  const calls = [];
  const sent = [];
  let memory = { presentacion_realizada: true, nombre: "Maria Esther", sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo." };
  const message = { id: 400, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "No todo bien\nGracias", attachments: [] };
  const conversation = { id: 21, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Lamento que no todo vaya bien. ¿Qué problema tienes?", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} },
    handoffRouter: {}, workflow: null,
    followUps: { afterReply: id => calls.push(["after", id]), customerWrote: id => calls.push(["wrote", id]) },
  });
  await processor.process(21, { ids: ["400"], webhookMessages: new Map([["400", message]]) });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^Con gusto, Maria\. Quedo al pendiente/);
  assert.doesNotMatch(sent[0], /Lamento|problema/);
  assert.deepEqual(calls, [["wrote", 21]], "no se programan seguimientos tras la despedida");
});

test("si la IA abre con 'Mia de MARTCOM.' sin saludo, se completa la presentación", async () => {
  const sent = [];
  const message = { id: 500, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Comenzar con mi afiliación al IMSS", attachments: [] };
  const conversation = { id: 22, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Mia de MARTCOM. Para comenzar con tu afiliación al IMSS, ¿me confirmas tu nombre completo?", question_key: "nombre" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} },
    handoffRouter: {}, workflow: null,
  });
  await processor.process(22, { ids: ["500"], webhookMessages: new Map([["500", message]]) });
  assert.equal(sent[0], "¡Hola! Soy Mia de MARTCOM. Para comenzar con tu afiliación al IMSS, ¿me confirmas tu nombre completo?");
});
