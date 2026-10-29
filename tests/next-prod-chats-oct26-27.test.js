import test from "node:test";
import assert from "node:assert/strict";
import { deferralDecision } from "../src/sales/customer-deferral.js";
import { shortAffirmative } from "../src/sales/start-confirmation.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { callRequest, acceptsAdvisorOffer } from "../src/core/human-request.js";
import { specializedAdviceHandoff } from "../src/core/specialized-advice-handoff.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";

// Chats reales del 26 y 27 de octubre (export del Inspector).
const key = t => detectDirectRequest(fixCommonTypos(t))?.answerKey || null;

test("preguntas nuevas con respuesta fija", () => {
  assert.equal(key("Eres una inteligencia artificial?"), "are_you_ai");
  assert.equal(key("Ofrecemos servicio de nómina para empresas, ¿les interesa?"), "b2b");
});

test("ya no responde como procedimiento médico cuando habla de pensión o de que no puede trabajar", () => {
  assert.notEqual(key("Ya no puedo trabajar y me faltan semanas para la pensión"), "medical_specific_procedure");
});

test("'no estoy pensionado' no es estar pensionado", () => {
  assert.notEqual(key("No estoy pensionado todavía"), "already_pensioned");
});

test("llamadas y aceptar asesor", () => {
  assert.equal(callRequest("Si o algún telefono para podee marcar"), true);
  assert.equal(callRequest("No hay comunicación vía telefónica?"), true);
  assert.equal(acceptsAdvisorOffer("Sí, revisarlo por favor", "¿O prefieres que un asesor revise tu caso?"), true);
});

test("invalidez: 'ya no puedo trabajar' con semanas pasa a un especialista", () => {
  assert.ok(specializedAdviceHandoff("Ya no puedo trabajar, tengo 400 semanas, ¿qué solución hay?"));
});

test("despedidas y '. .si'", () => {
  assert.ok(deferralDecision({ ultima_respuesta_agente: "El Plan 1 cuesta $1,100 al mes." }, "Ok, se lo agradezco, buena tarde"));
  assert.equal(deferralDecision({}, "No me acuerdo"), null);
  assert.equal(shortAffirmative(". .si"), true);
});

import { ConversationProcessor } from "../src/core/conversation-processor.js";
function run(content, memory = {}) {
  const state = { sent: [], events: [], memory: structuredClone(memory) };
  const m = { id: 900, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: Math.floor(Date.now() / 1000) };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 }, sender: { id: 1 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "¿Qué buscas principalmente?" }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type) { state.events.push(type); } },
    handoffRouter: {},
  });
  return p.process(5, { ids: ["900"], webhookMessages: new Map([["900", m]]) }).then(() => state);
}

test("un mensaje de solo puntos no se contesta", async () => {
  const s = await run(".", { ultima_respuesta_agente: "Te recomiendo el Plan 2." });
  assert.deepEqual(s.sent, []);
  assert.ok(s.events.includes("punctuation_only_skipped"));
});

import { directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
test("incapacidad por enfermedad en ambos planes; nunca por riesgo de trabajo (confirmado 27-oct)", () => {
  const plan1 = directAnswerText(detectDirectRequest(fixCommonTypos("En el 1 no contempla incapacidades?")));
  assert.match(plan1, /Plan 1 .*sí incluye incapacidad por enfermedad/);
  assert.match(plan1, /no trabajas para nosotros/);
  const dis = directAnswerText(detectDirectRequest(fixCommonTypos("¿Las incapacidades las pagan?")));
  assert.match(dis, /Los dos planes incluyen incapacidad por enfermedad/);
  assert.match(dis, /riesgo de trabajo/);
  assert.doesNotMatch(dis, /se contemplan en el Plan 2/);
});

test("respuestas confirmadas 27-oct: simulación, preexistentes, salario mayor, ISSSTE", () => {
  const ans = t => directAnswerText(detectDirectRequest(fixCommonTypos(t)));
  assert.match(ans("Que tenga elementos para demostrar que no es una simulación (nómina, contrato, estabilidad del patrón, domicilio del patrón)"), /no es posible.*rentas el servicio/s);
  assert.equal(key("Si, mi nombre es Leonardo Tapia Camargo y necesito estar dos años con la misma empresa"), "employment_proof");
  assert.match(ans("Existe alguna limitación respecto a enfermedades? en la modalidad 10 hay enfermedades que no aplican el primer año"), /^No, no hay ningún problema/);
  const salary = ans("Hay otro monto q supere este salario");
  assert.match(salary, /dos planes.*\$480.*comunique con un asesor/s);
  assert.equal(acceptsAdvisorOffer("Sí", salary), true);
  assert.equal(key("Yo quisiera cotizar en el seguro con 22 UMAS"), "higher_salary");
  assert.equal(key("Puedo pasar mis semanas del ISSSTE?"), "advisor_topic");
  assert.equal(key("Me interesa la incorporación voluntaria"), "advisor_topic");
  assert.equal(key("Trabajé en el ISSSTE hace años"), null);
  assert.equal(key("¿La empresa sería la misma de siempre?"), "same_company");
});
