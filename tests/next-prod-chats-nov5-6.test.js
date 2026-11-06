import test from "node:test";
import assert from "node:assert/strict";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { shortAffirmative } from "../src/sales/start-confirmation.js";
import { detectScheduledStart, SCHEDULE_OFFER_MARK } from "../src/sales/scheduled-start.js";
import { featureRejectionDecision } from "../src/sales/feature-rejection.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { orchestrateConversation, detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// Export del 5 y 6-nov.
const PLAN = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?" };

test("preguntas que se tomaban como 'lo pospone' (conv 11347 y 11297)", () => {
  assert.equal(detectDeferral("Cómo los contacto\nPara afiliarme con ustedes"), null);
  assert.equal(detectDeferral("Pero como se haría si todavía tengo vigente el próximo mes de diciembre❓🤔"), null);
  assert.equal(detectDeferral("Cuando pueda le aviso"), "later", "sigue siendo posponer");
  assert.equal(detectDirectRequest("Cómo los contacto\nPara afiliarme con ustedes")?.answerKey, "how_to_start");
  assert.equal(detectDeferral("Estoy checando los documentos \nY y reporto con UD."), "later");
  assert.match(deferralDecision(PLAN, "Esta claro deje y checo papeles").reply, /Cuando tengas a la mano tu CURP, NSS e INE/);
  assert.equal(detectDeferral("Déjeme que lo hable con mi hijo porque el me va a  apoyar con lo económico"), "no_money");
  assert.match(deferralDecision(PLAN, "Checo lo económico y me pongo en contacto con ustedes. Si me interesa pero necesito checarlo").reply, new RegExp(SCHEDULE_OFFER_MARK.replace(/[?¿]/g, ".")));
});

test("urgencia: '¿en qué tiempo estaría vigente? necesito estar antes del lunes' se contesta y se cierra", () => {
  const o = orchestrateConversation("Me interesa mucho \nPero a la vez... necesito estar dado de alta antes de este lunes porque tengo citas pendientes y no las quiero perder \nEn qu3 tiempo estaría vigente en el IMSS", {});
  assert.match(o.directAnswer, /48 horas hábiles\. Si me compartes hoy tu CURP, NSS e INE, la iniciamos de inmediato/);
  assert.equal(detectDirectRequest("En cuanto tiempo quedo dado de alta")?.answerKey, "process_time", "sin urgencia, igual que antes");
});

test("respuestas nuevas: contacto, baja después de pagar, constancia fiscal, pago aparte", () => {
  assert.match(orchestrateConversation("A donde los contacto aparte de aquí?", PLAN).directAnswer, /prefieres que un asesor te llame/);
  assert.match(orchestrateConversation("Que seguridad tengo que no me dan de baja después de pagar?", PLAN).directAnswer, /primero compruebas y después pagas/);
  assert.match(orchestrateConversation("Nececito la constancia", PLAN).directAnswer, /no necesitas la Constancia de Situación Fiscal, aunque seas ama de casa/);
  assert.equal(detectDirectRequest("Que documentos ocupo")?.answerKey, "requirements");
  assert.equal(detectDirectRequest("Para sus servicios hay pago aparte")?.answerKey, "fees");
  assert.match(orchestrateConversation("Estoy buscando otra opción deje de cotizar tengo 320 semanas soy regimen 73", PLAN).directAnswer, /te faltan unas 180 para las 500/);
});

test("ya tiene vigencia con otro gestor: se ofrece programar el alta y la fecha acepta", () => {
  const o = orchestrateConversation("Pero como se haría si todavía tengo vigente el próximo mes de diciembre❓🤔", PLAN);
  assert.ok(o.directAnswer.endsWith(SCHEDULE_OFFER_MARK));
  const after = analyzeNextSale("el 1 de enero", { ...PLAN, ultima_respuesta_agente: o.directAnswer });
  assert.equal(after.authorized, true);
  assert.equal(after.patch.sales_cycle.scheduled_start.when, "el 1 de enero");
});

test("'Si porfsvor', 'si me gustaría pero me pagan hasta el sbdo'", () => {
  assert.equal(shortAffirmative("Si porfsvor"), true);
  assert.equal(shortAffirmative("si porfa vor"), true);
  assert.equal(detectScheduledStart("Si me gustaría pero a mí me pagan hasta el sbdo")?.when, "el sábado");
  assert.equal(analyzeNextSale("Si me gustaría pero a mí me pagan hasta el sbdo", PLAN).authorized, true);
});

test("quiere AFORE pero no INFONAVIT: es el Plan 2 (conv 11328)", () => {
  const d = featureRejectionDecision({}, "Servicio de IMSS\nacumular semanas\naportaciones al Afore\n\nInfonavit no");
  assert.equal(d.plan, "plan_2");
  assert.match(d.reply, /Plan 2, de \$1,500/);
  assert.equal(featureRejectionDecision({}, "No me interesa infonavit").plan, "plan_1");
});

test("en el processor: tras 'no me interesa infonavit' el plan que queda es el 1", async () => {
  let memory = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_2" }, commercial_need: { afore_infonavit: true }, ultima_respuesta_agente: "El Plan 2 puede ajustarse mejor a lo que buscas." };
  const message = { id: 801, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "No me interesa infonavit", attachments: [] };
  const sent = [];
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 41, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
  });
  await processor.process(41, { ids: ["801"], webhookMessages: new Map([["801", message]]) });
  assert.match(sent[0], /el Plan 1 de \$1,100/);
  assert.equal(memory.sales_cycle.last_plan, "plan_1");
  assert.equal(memory.commercial_need.afore_infonavit, false);
});

test("en el processor las respuestas nuevas salen tal cual (no las reescribe la IA)", async () => {
  const run = async (text, memory0) => {
    let memory = structuredClone(memory0);
    const message = { id: 902, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: text, attachments: [] };
    const sent = [];
    const p = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id: 52, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage(_id, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(memory), async set(_id, n) { memory = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "LLM", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
      inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
    });
    await p.process(52, { ids: ["902"], webhookMessages: new Map([["902", message]]) });
    return sent.join(" ");
  };
  const plan = { presentacion_realizada: true, ...structuredClone(PLAN) };
  assert.match(await run("Pero como se haría si todavía tengo vigente el próximo mes de diciembre❓🤔", plan), /programar tu alta para que empiece justo cuando termine/);
  assert.match(await run("Que seguridad tengo que no me dan de baja después de pagar?", plan), /primero compruebas y después pagas/);
  assert.match(await run("Debo aportar $1,100 al mes y con eso cubre el servicio médico y aporte al afore?", plan), /no incluye aportaciones a AFORE/);
  assert.match(await run("Y los pagos al IMSS lo aria yo directo al seguro", plan), /tú no le pagas directo al IMSS/);
  assert.match(await run("Si porfsvor", { ...plan, ultima_respuesta_agente: "Gracias. Con lo que me cuentas, el Plan 1 es el que mejor se ajusta a lo que buscas. ¿Quieres que te explique cómo funciona?", sales_cycle: { recommended_plan: "plan_1" } }), /^Claro\. El Plan 1 incluye/);
  assert.match(await run("Me interesa mucho \nPero necesito estar dado de alta antes de este lunes porque tengo citas pendientes \nEn qu3 tiempo estaría vigente en el IMSS", { presentacion_realizada: true, ultima_respuesta_agente: "¿Sigues por aquí?" }), /la iniciamos de inmediato/);
});
