import test from "node:test";
import assert from "node:assert/strict";
import { updateProfile, profileFacts, personalTouch } from "../src/memory/customer-profile.js";
import { leadScore } from "../src/sales/lead-score.js";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { MiaConsole } from "../src/inspector/mia-console.js";

// 9-nov: ficha del cliente (punto 1) y puntaje de compra (punto 3).
const now = new Date("2026-11-09T18:00:00Z");

test("ficha: semanas, ley, año, edad, trabajo, para quién, objeción y prisa", () => {
  let p = {};
  for (const t of ["Estoy buscando otra opción deje de cotizar tengo 320 semanas soy regimen 73", "Empecé a cotizar en el 1986", "Tengo 58 años y no tengo trabajo", "Es para mi mamá", "Está muy caro", "Me interesa mucho, necesito estar dado de alta antes de este lunes porque tengo citas pendientes", "Cómo se paga?"]) p = updateProfile(p, t, { now });
  assert.equal(p.weeks, 320); assert.equal(p.ley, 73); assert.equal(p.start_year, 1986); assert.equal(p.age, 58);
  assert.equal(p.work, "sin empleo formal"); assert.equal(p.for_whom, "sus papás"); assert.equal(p.objection, "precio");
  assert.match(p.urgency, /antes de este lunes/);
  assert.ok(p.signals.asked_payment && p.signals.urgency && p.signals.interest);
  assert.equal(updateProfile({}, "tengo 15 años sin cotizar").age, undefined, "años sin cotizar no es la edad");
  assert.equal(updateProfile({}, "empecé en 1999").ley, 97);
  assert.deepEqual(profileFacts(p).map(([k]) => k), ["Para quién", "Edad", "Trabajo", "Semanas", "Ley", "Le interesa", "Objeción", "Prisa"]);
  assert.match(personalTouch(p), /tienes prisa/);
  assert.match(personalTouch({ weeks: 589, ley: 73 }), /ya tienes las 500 mínimas/);
  assert.equal(personalTouch({}), null);
});

test("con la ficha no se vuelve a preguntar: '¿cuántas semanas necesito?' usa sus semanas", () => {
  const o = orchestrateConversation("Cuantas semanas necesito para pensionarme?", { profile: { weeks: 320, ley: 73 } });
  assert.match(o.directAnswer, /^Con 320 semanas en Ley 73 te faltan unas 180/);
});

test("puntaje de compra: alto, medio, bajo y aceptó", () => {
  const hot = leadScore({ sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, profile: { urgency: "antes del lunes", signals: { asked_payment: "x", interest: "x" } } }, { lastCustomerAt: new Date(now - 30 * 60e3).toISOString(), now });
  assert.equal(hot.level, "high");
  assert.ok(hot.reasons.includes("Preguntó cómo pagar") && hot.reasons.includes("Tiene prisa"));
  const mid = leadScore({ sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] } }, { lastCustomerAt: new Date(now - 5 * 3600e3).toISOString(), now });
  assert.equal(mid.level, "medium");
  assert.equal(leadScore({ sales_cycle: { recommended_plan: "plan_1", deferral: "closing" } }, { lastCustomerAt: new Date(now - 4 * 86400e3).toISOString(), now }).level, "low");
  assert.equal(leadScore({ sales_cycle: { authorized: true } }).label, "Aceptó");
  assert.equal(leadScore({ no_contact: true }).score, 0);
});

test("Chats de Mia: cada chat trae puntaje y ficha; 'Más probables' ordena por puntaje", () => {
  const mems = {
    1: { id: 1, nombre: "Baja", sales_cycle: { recommended_plan: "plan_1", deferral: "closing" } },
    2: { id: 2, nombre: "Alta", sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, profile: { weeks: 320, ley: 73, signals: { asked_payment: "x" } } },
    3: { id: 3, nombre: "Aceptó", sales_cycle: { authorized: true } },
  };
  const ev = id => [{ type: "ai_reply_sent", timestamp: new Date(now - (4 - id) * 60e3).toISOString(), details: { customer_text: "hola", reply: "x", decision_source: "llm" } }];
  const c = new MiaConsole({ config: { ai: {} }, memories: { list: () => Object.values(mems), get: id => mems[id] }, inspectorEvents: { listAll: () => [1, 2, 3].flatMap(id => ev(id).map(e => ({ ...e, conversationId: id }))), get: id => ev(id) } });
  const byScore = c.rescueList({ now, sort: "score" }).items.map(i => i.name);
  assert.deepEqual(byScore, ["Alta", "Baja", "Aceptó"]);
  const alta = c.rescueList({ now, sort: "score" }).items[0];
  assert.equal(alta.score.level, "high");
  assert.deepEqual(alta.profile.find(([k]) => k === "Semanas"), ["Semanas", "320"]);
  assert.deepEqual(c.rescueList({ now }).items.map(i => i.name), ["Aceptó", "Alta", "Baja"], "por defecto, más recientes");
});

test("en el processor: la ficha se guarda y la explicación del plan cierra con su situación", async () => {
  let memory = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1" }, profile: { weeks: 320, ley: 73 }, ultima_respuesta_agente: "Gracias. Con lo que me cuentas, el Plan 1 es el que mejor se ajusta a lo que buscas. ¿Quieres que te explique cómo funciona?" };
  const sent = [];
  const message = { id: 71, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Sí, explíqueme por favor, es para mi mamá", attachments: [] };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 81, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_i, n) { memory = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "LLM", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
  });
  await p.process(81, { ids: ["71"], webhookMessages: new Map([["71", message]]) });
  assert.equal(memory.profile.for_whom, "sus papás");
  assert.match(sent[0], /^Claro\. El Plan 1 incluye.*Con tus 320 semanas en Ley 73, cada mes con nosotros te acerca a las 500 .* ¿Quieres que iniciemos tu trámite\?$/s);
});
