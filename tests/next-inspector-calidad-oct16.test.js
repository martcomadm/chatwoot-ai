import test from "node:test";
import assert from "node:assert/strict";
import { extractAge } from "../src/semantic/age-extractor.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { isInformationOpening, progressiveOpeningDecision } from "../src/sales/progressive-disclosure.js";
import { fallbackDecision } from "../src/core/fallback.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { replacedReasonLabel } from "../src/inspector/mia-console.js";

// Casos que marcó la vista Calidad del Inspector (30-sep al 16-oct).

test("edad en respuestas cortas: 'ACTUALMENTE 58', '56 ya próximamente 57'", () => {
  const asked = { ultima_pregunta: "edad" };
  assert.equal(extractAge("ACTUALMENTE 58", asked)?.value, 58);
  assert.equal(extractAge("56 ya próximamente 57.", asked)?.value, 56);
  assert.equal(extractAge("58", { ultima_respuesta_agente: "¿Cuántos años tienes?" })?.value, 58);
  assert.equal(extractAge("Tengo 1400 semanas", asked), null);
  assert.equal(extractAge("ACTUALMENTE 58", {}), null);
});

test("'Ojalá me iciera el fabor' a '¿Te gustaría que iniciemos tu trámite?' = sí", () => {
  const memory = { ultima_respuesta_agente: "Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el Plan 1? Si tienes alguna duda, con gusto te la resuelvo." };
  assert.equal(confirmsStart("Ojalá me iciera el fabor", memory), true);
  assert.equal(confirmsStart("Si me hace el favor", memory), true);
  assert.equal(confirmsStart("Ojalá me iciera el fabor", { ultima_respuesta_agente: "¿A qué te dedicas?" }), false);
});

test("'¿Le podrían checar cómo ando?' y 'Qué beneficios me ofrece' tienen respuesta", () => {
  assert.equal(detectDirectRequest("Le'podriad Chekar Como Ando????")?.type, "case_review");
  assert.equal(detectDirectRequest("Atención Médica O Que Beneficios Me Ofrece")?.type, "services");
});

test("'Comenzar con mi afiliación al IMSS' (botón del anuncio) recibe un saludo propio", () => {
  assert.equal(isInformationOpening("Comenzar con mi afiliación al IMSS"), true);
  assert.match(progressiveOpeningDecision({}, "Comenzar con mi afiliación al IMSS").reply, /te ayudo con tu afiliación/);
});

test("Mia ya no se queda callada cuando la pregunta pendiente se repite", () => {
  const memory = { ultima_pregunta: "edad", ultima_respuesta_agente: "¿Cuál es tu edad?" };
  const d = fallbackDecision(memory, { question_key: "edad" }, "mmm");
  assert.ok(d.reply.length > 0);
  assert.match(d.reply, /edad/);
  const again = fallbackDecision({ ...memory, ultima_respuesta_agente: d.reply }, { question_key: "edad" }, "mmm");
  assert.ok(again.reply.length > 0);
  assert.notEqual(again.reply, d.reply);
});

test("el evento guarda lo que escribió la IA y por qué se cambió; el Inspector lo traduce", async () => {
  const events = [];
  const m = { id: 990, message_type: 0, content: "No estoy trabajando", private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact" };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 75, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage() {}, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({ presentacion_realizada: true, nombre: "Griselda Ruiz", edad: 44, ultima_respuesta_agente: "¿A qué te dedicas actualmente?", commercial_need: { retirement: true } }), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "¿Cuál es tu nombre? ¿Y tu edad?", question_key: null }), repairDecision: async () => ({ reply: "¿Nombre? ¿Edad?" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, data) { events.push({ type, data }); } },
    handoffRouter: {}, workflow: null,
  });
  await p.process(75, { ids: ["990"], webhookMessages: new Map([["990", m]]) });
  const sent = events.find(e => e.type === "ai_reply_sent")?.data;
  assert.equal(sent.ai_draft, "¿Cuál es tu nombre? ¿Y tu edad?");
  assert.ok(sent.replaced_reasons.includes("multiples_preguntas"));
  assert.ok(sent.replaced_reasons.includes("reparacion_fallida"));
  assert.equal(replacedReasonLabel("multiples_preguntas"), "Hacía más de una pregunta");
  assert.match(replacedReasonLabel("pregunta_ya_contestada:edad"), /ya contestado \(edad\)/);
});

test("chats de prueba: fuera de Hoy, Calidad y Embudo; visibles solo en el filtro Pruebas", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { MiaConsole } = await import("../src/inspector/mia-console.js");
  const now = new Date();
  const events = [
    { conversationId: 1, type: "ai_reply_sent", timestamp: now.toISOString(), details: { reply: "¿Me compartes un poco más sobre tu situación?", decision_source: "fallback" } },
    { conversationId: 2, type: "ai_reply_sent", timestamp: now.toISOString(), details: { reply: "¿Me compartes un poco más sobre tu situación?", decision_source: "fallback" } },
    { conversationId: 3, type: "lab.conversation_reset", timestamp: now.toISOString(), details: {} },
    { conversationId: 3, type: "ai_reply_sent", timestamp: now.toISOString(), details: { reply: "x", decision_source: "fallback" } },
  ];
  const mems = [{ id: 1, nombre: "Cliente real" }, { id: 2, nombre: "YANEZ CASANOVA MIGUEL AXEL" }, { id: 3, nombre: "Lab" }];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insp-test-")), "t.json");
  const make = () => new MiaConsole({
    config: { ai: {}, inspector: { testConversations: [] }, chatwoot: {} },
    memories: { list: () => mems, get: id => mems.find(m => m.id === Number(id)) || {} },
    inspectorEvents: { listAll: () => events, get: id => events.filter(e => e.conversationId === Number(id)) },
    testFile: file,
  });
  const c = make();
  assert.deepEqual(c.quality({ days: 7, now }).items.map(i => i.id).sort(), [1, 2]);
  c.setTest(2, true);
  assert.deepEqual(c.quality({ days: 7, now }).items.map(i => i.id), [1], "la prueba marcada y la del LAB no cuentan");
  assert.deepEqual(make().conversations({}).items.map(i => i.id), [1], "se guarda en archivo");
  assert.deepEqual(make().conversations({ filter: "tests" }).items.map(i => i.id).sort(), [2, 3]);
  make().setTest(2, false);
  assert.deepEqual(make().quality({ days: 7, now }).items.map(i => i.id).sort(), [1, 2]);
});
