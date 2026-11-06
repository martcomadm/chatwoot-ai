import test from "node:test";
import assert from "node:assert/strict";
import { requestsSensitiveData } from "../src/core/next-commercial-guard.js";
import { contextualPlanExplanation, medicalNotNeededDecision } from "../src/sales/progressive-disclosure.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { acceptsAdvisorOffer } from "../src/core/human-request.js";
import { ConversationProcessor, explainedPlanInReply } from "../src/core/conversation-processor.js";

// Chats reales del 15-oct (tarde): Mia descartaba casi todas las respuestas de la IA.

test("mencionar CURP/NSS no es pedirlos: la respuesta de la IA ya no se descarta", () => {
  assert.equal(requestsSensitiveData({ reply: "Para iniciar necesitamos CURP, NSS e INE del titular. ¿Quieres que iniciemos tu trámite?" }), false);
  assert.equal(requestsSensitiveData({ reply: "Primero se hace tu alta con tu CURP y NSS; después realizas tu pago." }), false);
  assert.equal(requestsSensitiveData({ reply: "¿Me compartes tu CURP, por favor?" }), true);
  assert.equal(requestsSensitiveData({ reply: "Compárteme tu NSS para continuar." }), true);
  assert.equal(requestsSensitiveData({ reply: "Listo.", question_key: "curp" }), true);
});

test("'Porfavor explíqueme…!!', 'Porfavor.' y 'Si.' tras la oferta reciben la explicación del plan", () => {
  const memory = { commercial_need: { weeks: true }, sales_cycle: { pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "Gracias. Con lo que me cuentas, el Plan 1 es el que mejor se ajusta a lo que buscas. ¿Quieres que te explique cómo funciona?" };
  for (const text of ["Porfavor explíqueme…!!", "Porfavor.", "Si.", "Sí, por favor", "Explíqueme por favor"]) {
    assert.match(contextualPlanExplanation(memory, text)?.reply || "", /El Plan 1 incluye/, text);
  }
});

test("orden alta/pago y salario contra pensión tienen respuesta propia", () => {
  assert.equal(detectDirectRequest("Primero verificar mi alta y después se deposita o es primero el deposito…?.")?.type, "payment_order");
  assert.equal(detectDirectRequest("¿Cuándo hago el pago?")?.type, "payment_order");
  assert.equal(detectDirectRequest("Si entiendo pero con ese salario registrado me\nConviene para buena pensión")?.type, "salary_pension");
  assert.equal(detectDirectRequest("¿Qué salario registrado manejan?")?.type, "registered_salary");
});

test("'sí' a '¿Quieres que te comunique con un asesor?' pasa con un asesor", () => {
  const offer = "…un asesor puede revisar cómo te conviene. ¿Quieres que te comunique con un asesor?";
  assert.equal(acceptsAdvisorOffer("Si", offer), true);
  assert.equal(acceptsAdvisorOffer("Sí, por favor", offer), true);
  assert.equal(acceptsAdvisorOffer("No, gracias", offer), false);
  assert.equal(acceptsAdvisorOffer("Si", "¿Quieres que te explique cómo funciona?"), false);
});

test("una explicación hecha por la IA cuenta como explicada; 'no me interesa el médico' ya no re-ofrece explicar", () => {
  assert.equal(explainedPlanInReply("El Plan 1 tiene un costo de $1,100 MXN/mes; permite seguir cotizando semanas con salario diario registrado de $480 MXN, incluye acceso a seguro médico IMSS."), "plan_1");
  assert.equal(explainedPlanInReply("El Plan 1 cuesta $1,100 MXN y el Plan 2 $1,500 MXN."), null);
  const d = medicalNotNeededDecision({ sales_cycle: { explained_plans: ["plan_1"] } }, "no me interesa el servicio médico");
  assert.match(d.reply, /iniciemos tu trámite/);
});

function processor({ memory, text, generated }) {
  const sent = [];
  let mem = structuredClone(memory);
  const m = { id: 970, message_type: 0, content: text, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact" };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 74, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_id, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_id, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => generated, repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null,
  });
  return { run: () => p.process(74, { ids: ["970"], webhookMessages: new Map([["970", m]]) }), sent, memory: () => mem };
}

test("la respuesta de la IA que menciona los requisitos se envía tal cual", async () => {
  const reply = "Con 1,400 semanas ya tienes una base importante. Con el Plan 1 sigues sumando semanas; para iniciar necesitamos CURP, NSS e INE del titular. ¿Quieres que iniciemos tu trámite?";
  const t = processor({ memory: { presentacion_realizada: true, nombre: "Ana Lopez", edad: 56, actividad: "comerciante", commercial_need: { weeks: true }, sales_cycle: { pitched_plans: ["plan_1"], explained_plans: ["plan_1"] }, ultima_respuesta_agente: "x" }, text: "Tengo alrededor de 1400 semanas cotizadas pero hace 8 años que no cotizo constantemente", generated: { reply, question_key: null } });
  await t.run();
  assert.deepEqual(t.sent, [reply]);
});

test("'Todo' a la pregunta de necesidad recomienda el Plan 2", async () => {
  const t = processor({ memory: { presentacion_realizada: true, nombre: "Fernanda Medina", edad: 28, actividad: "vendedora ambulante", ultima_pregunta: "necesidad_principal", ultima_respuesta_agente: "Fernanda, para orientarte mejor, ¿qué es lo más importante para ti con la afiliación: tener servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?" }, text: "Todo", generated: { reply: "¿Hay algo más en lo que te pueda ayudar?", question_key: null } });
  await t.run();
  assert.match(t.sent[0], /Plan 2/);
});
