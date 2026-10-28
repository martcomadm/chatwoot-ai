import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { detectDirectRequest, directAnswerText, orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { deferralDecision, isClosingReply } from "../src/sales/customer-deferral.js";
import { hasActiveInfonavitCredit } from "../src/sales/infonavit-credit.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { buildOnboardingDecision, CALL_ACK_TEXT, DOCS_LATER_TEXT } from "../src/operations/onboarding-service.js";

// Chats reales del 27 y 28 de octubre (export del Inspector).
const key = t => detectDirectRequest(fixCommonTypos(t))?.answerKey || null;
const ans = t => directAnswerText(detectDirectRequest(fixCommonTypos(t)));

test("preguntas que se contestaban con algo genérico o equivocado", () => {
  assert.equal(key("En qué momento sería el primer pago?"), "payment_order");
  assert.equal(key("A donde te tengo que hacer el pago  Para transferirte de una vez"), "payment_method");
  assert.equal(key("Pásame los datos de la cuenta para hacer los depósitos correspondientes y el nombre del responsable"), "payment_method");
  assert.match(ans("Datos de la cuenta para depositar"), /hasta que tu alta esté vigente.*¿Quieres que iniciemos tu trámite\?$/s);
  assert.equal(key("Me podrías mandar las 2 cotizaciones es decir solo el servicio médico y cuanto por todos los demás opciones de cotizar , afore e infonavit"), "price");
  assert.equal(key("O sea que no cambian constantemente de empresas ni hay altas y bajas constantes"), "same_company");
  assert.equal(key("Aparte de altas en el imss tienes otros servicios?"), "other_services");
  assert.equal(key("Lo único que me falta es el número de afiliación y no lo tengo no me acuerdo cuál es"), "nss_lookup");
  assert.match(ans("Es que requiero que puedan otorgar carta de la empresa con razón social y probatoria para la modalidad 40"), /Para la Modalidad 40 no se ocupa/);
  assert.equal(key("Necesito la carta patronal para la guardería"), "daycare");
});

test("salario mayor y gobierno: se ofrece asesor", () => {
  assert.equal(key("El punto es que mi último salario diario cotizado es de $2,556"), "higher_salary");
  assert.equal(key("No me queda claro, el registro de $480, baja mi salario diario cotizado"), "higher_salary");
  assert.equal(key("Trabaje como 10 años en el gobierno de Jalisco pero esto no me contó, ¿podrá hacer algo?"), "advisor_topic");
  assert.equal(key("En que cambia mi trámite trabajé en PF Policia Federal hasta 2019"), "advisor_topic");
  assert.doesNotMatch(ans("Me va a cotizar con muy poco"), /no se puede cambiar/);
});

test("crédito INFONAVIT dicho de otras formas", () => {
  assert.equal(hasActiveInfonavitCredit("Si también aforé eè Infonavit tengo crédito"), true);
  assert.equal(hasActiveInfonavitCredit("Servicio médico,cotizar semanas y seguir pagando Infonavit"), true);
  assert.equal(hasActiveInfonavitCredit("Quiero aportar a Infonavit"), false);
});

test("despedidas y posponer", () => {
  const m = { ultima_respuesta_agente: "¿Quieres que te explique cómo funciona?" };
  assert.equal(deferralDecision(m, "Ya encontré muchas gracias")?.deferral, "declined");
  assert.equal(deferralDecision(m, "Lo conoszco y creo está bien el precio lo comento con mis clientes  y me vuelvo a comunicar")?.deferral, "later");
  assert.equal(deferralDecision(m, "en otro momento  gracias")?.deferral, "later");
  assert.equal(isClosingReply("Entendido. Cuando quieras retomar el trámite, aquí estamos para ayudarte. Que tengas un buen día."), true);
  assert.equal(isClosingReply("Gracias, José. Cuando pueda escríbame por aquí y retomamos su trámite; quedo al pendiente."), true);
  assert.equal(isClosingReply("¿Quieres que iniciemos tu trámite?"), false);
});

test("'Sí' a '¿Te quedó alguna duda?' invita a preguntar", () => {
  const o = orchestrateConversation("Si", { ultima_respuesta_agente: "¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo." });
  assert.equal(o.directRequest.answerKey, "has_doubts");
  assert.equal(orchestrateConversation("Si", { ultima_respuesta_agente: "¿Quieres que te explique cómo funciona?" }).directRequest, null);
});

test("'Plan 2. Empezamos con el trámite' e 'Iniciamos mi trámite' abren el trámite con ese plan", () => {
  const memory = { nombre: "Juan", sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], stage: "plan_explained" }, commercial_need: "pension", ultima_respuesta_agente: "Listo. Para iniciar confirma cuál plan quieres" };
  const c = commitmentDecision(memory, "Plan 2\nEmpezamos con el trámite");
  assert.equal(c.commitment, "authorized");
  assert.match(c.reply, /Plan 2/);
  assert.equal(commitmentDecision(memory, "Iniciamos mi trámite").commitment, "authorized");
  const sale = analyzeNextSale("Plan 2\nEmpezamos con el trámite", memory);
  assert.equal(sale.patch.sales_cycle.authorized, true);
  assert.equal(sale.patch.sales_cycle.selected_plan, "plan_2");
});

test("expediente abierto: 'en otro momento', '¿qué documentos ocupas?', 'más tarde voy en el transporte', precisar horario", () => {
  const memory = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", onboarding_next: "curp", documents_missing: ["curp", "nss", "ine"] }, ultima_respuesta_agente: "Para continuar con tu expediente, compárteme por favor la CURP del titular." };
  assert.equal(buildOnboardingDecision(memory, "en otro momento gracias").reply, DOCS_LATER_TEXT);
  assert.equal(buildOnboardingDecision(memory, "Más tarde voy en el trasporte").reply, DOCS_LATER_TEXT);
  assert.match(buildOnboardingDecision(memory, "Perdón q ocupas de documentos").reply, /CURP, NSS e INE.*me falta: CURP/s);
  const now = Date.now();
  const call = { ...memory, operations: { ...memory.operations, call_requested_at: new Date(now - 60000).toISOString() }, call_ack_at: new Date(now - 30000).toISOString(), ultima_respuesta_agente: CALL_ACK_TEXT };
  assert.equal(buildOnboardingDecision(call, "Entre 9 y 11 de la mañana").reply, "Anotado, también se lo comento al asesor.");
});

function run(content, memory = {}) {
  const state = { sent: [], events: [], followups: 0, memory: structuredClone(memory) };
  const m = { id: 900, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: Math.floor(Date.now() / 1000) };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 }, sender: { id: 1 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Entendido. Cuando quieras retomar el trámite, aquí estamos para ayudarte. Que tengas un buen día." }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type) { state.events.push(type); } },
    handoffRouter: {},
    followUps: { afterReply() { state.followups++; }, customerWrote() {}, cancel() {}, remove() {} },
  });
  return p.process(5, { ids: ["900"], webhookMessages: new Map([["900", m]]) }).then(() => state);
}

test("pedir la cuenta por segunda vez: se ofrece asesor", async () => {
  const first = await run("Pásame la cuenta de banco para depositar", { ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 2?" });
  assert.match(first.sent[0], /hasta que tu alta esté vigente/);
  const second = await run("Datos de la cuenta para depositar los pagos", first.state?.memory || first.memory);
  assert.match(second.sent[0], /comunique con un asesor/);
});

test("la IA se despide: ya no se programan seguimientos", async () => {
  const s = await run("Es que estoy bien endeudado, tengo que esperarme", { ultima_respuesta_agente: "¿Quieres que te explique cómo funciona?", sales_cycle: { recommended_plan: "plan_1" } });
  assert.equal(s.sent.length, 1);
  assert.equal(s.followups, 0);
});
