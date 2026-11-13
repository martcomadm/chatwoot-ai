import test from "node:test";
import assert from "node:assert/strict";
import { AiServices } from "../src/ai/services.js";
import { hardTurnReason } from "../src/core/hard-turn.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// 9-nov: modelo avanzado solo donde se gana o se pierde la venta.
function fakeOpenAI({ failStrong = false } = {}) {
  const calls = [];
  return { calls, responses: { async create(params) { calls.push(params.model); if (failStrong && params.model === "grande") throw new Error("model not found"); return { output_text: JSON.stringify({ reply: `Respuesta de ${params.model}`, question_key: null }) }; } } };
}

test("mensajes difíciles: confianza, precio, pensión complicada, varias preguntas, molesto, tras respuesta genérica", () => {
  assert.equal(hardTurnReason({ text: "Me dicen que hay mucho fraude" }), "duda de confianza");
  assert.equal(hardTurnReason({ text: "Me ofrecieron lo mismo en 250 al mes" }), "compara precio");
  assert.equal(hardTurnReason({ text: "Estoy en modalidad 40, me conviene?" }), "caso de pensión complicado");
  assert.equal(hardTurnReason({ text: "Tengo semanas del ISSSTE y del IMSS" }), "caso de pensión complicado");
  assert.equal(hardTurnReason({ text: "¿Qué incluye? ¿Cuánto tarda? ¿Puedo meter a mi mamá?" }), "varias preguntas o mensaje largo");
  assert.equal(hardTurnReason({ text: "Ya te dije que no, no me entiendes" }), "cliente molesto");
  assert.equal(hardTurnReason({ text: "y eso como seria", memory: { ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?" } }), "Mia ya contestó algo genérico");
  assert.equal(hardTurnReason({ text: "Cuánto cuesta" }), null);
  assert.equal(hardTurnReason({ text: "Hola" }), null);
});

test("AiServices: avanzado solo si está configurado; si falla, el normal; cuenta el uso", async () => {
  const off = fakeOpenAI();
  const aiOff = new AiServices(off, { model: "mini" });
  assert.equal(aiOff.strongModel(), null);
  await aiOff.generateDecision({ messages: [] }, [], {}, {}, "fraude", { strong: true });
  assert.deepEqual(off.calls, ["mini"], "sin OPENAI_MODEL_STRONG todo va con el normal");

  const on = fakeOpenAI();
  const ai = new AiServices(on, { model: "mini", strongModel: "grande" });
  const d = await ai.generateDecision({ messages: [] }, [], {}, {}, "fraude", { strong: true });
  assert.equal(d.reply, "Respuesta de grande");
  assert.equal(d.__tier, "strong");
  await ai.generateDecision({ messages: [] }, [], {}, {}, "hola");
  await ai.repairDecision({ messages: [] }, {}, {}, "x", { reply: "y" }, ["generica"]);
  await ai.extractDocumentData([{ file_type: "image", data_url: "https://x/ine.jpg" }]);
  await ai.draftTeamAnswer({ question: "¿Puedo meter a mi mamá?" });
  assert.deepEqual(on.calls, ["grande", "mini", "grande", "grande", "grande"]);
  const u = ai.usage();
  assert.equal(u.strong_model, "grande");
  assert.equal(u.today.strong, 4);
  assert.equal(u.today.normal, 1);
  assert.equal(u.today.by_kind.correccion.strong, 1);

  const failing = fakeOpenAI({ failStrong: true });
  const ai2 = new AiServices(failing, { model: "mini", strongModel: "grande" });
  const d2 = await ai2.generateDecision({ messages: [] }, [], {}, {}, "fraude", { strong: true });
  assert.equal(d2.reply, "Respuesta de mini");
  assert.equal(ai2.usage().today.strong_failed, 1);
});

test("en el processor: el mensaje difícil va al avanzado y queda registrado", async () => {
  const records = [];
  let memory = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "x" };
  const strongCalls = [];
  const message = { id: 91, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Me quedé viuda y quiero saber si mi pensión por viudez se afecta si me doy de alta con ustedes", attachments: [] };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 95, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage() {}, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_i, n) { memory = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { strongModel: () => "grande", extractAmbiguous: async () => ({}), async generateDecision(_c, _l, _m, _p, _t, opts = {}) { strongCalls.push(Boolean(opts.strong)); return { reply: "Con Modalidad 40 tu caso es distinto; un asesor lo revisa contigo. ¿Te llamamos?", question_key: null, __tier: opts.strong ? "strong" : "normal" }; }, repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type, details) { records.push({ type, details }); } }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
  });
  await p.process(95, { ids: ["91"], webhookMessages: new Map([["91", message]]) });
  const sent = records.find(r => r.type === "ai_reply_sent");
  assert.ok(strongCalls.length, "lo contestó la IA");
  if (strongCalls.length) {
    assert.equal(strongCalls[0], true);
    assert.equal(sent.details.model_tier, "strong");
    assert.equal(sent.details.hard_turn, "caso de pensión complicado");
  } else {
    assert.ok(sent, "lo contestó una regla fija (no pasó por la IA)");
  }
});

import { buildImpact } from "../src/inspector/impact-service.js";
import { MiaConsole } from "../src/inspector/mia-console.js";
test("Inspector: Impacto cuenta el modelo avanzado (y los avisos nuevos); la conversación lo marca", async () => {
  const ev = (type, at, details = {}) => ({ type, timestamp: at, details });
  const eventsByConv = new Map([
    [1, [ev("ai_reply_sent", "2026-11-10T16:00:00Z", { customer_text: "Me dicen que es fraude", decision_source: "llm", model_tier: "strong", hard_turn: "duda de confianza", reply: "x" }), ev("hot_lead_alert", "2026-11-10T16:05:00Z")]],
    [2, [ev("ai_reply_sent", "2026-11-10T17:00:00Z", { customer_text: "hola", decision_source: "llm", model_tier: "normal", reply: "y" }), ev("early_call_offer", "2026-11-10T17:01:00Z")]],
  ]);
  const memories = [{ id: 1, sales_cycle: { authorized: true, authorized_at: "2026-11-10T18:00:00Z" } }, { id: 2 }];
  const i = buildImpact({ memories, eventsByConv, since: "2026-11-10", to: "2026-11-10", now: new Date("2026-11-11T00:00:00Z") });
  assert.deepEqual({ sent: i.after.strong.sent, accepted: i.after.strong.accepted, replies: i.after.strong.replies }, { sent: 1, accepted: 1, replies: 1 });
  assert.deepEqual(i.after.strong.reasons, [["duda de confianza", 1]]);
  assert.equal(i.after.hot_lead.sent, 1);
  assert.equal(i.after.early_call.sent, 1);

  const events = eventsByConv.get(1);
  const c = new MiaConsole({ config: { ai: {} }, memories: { list: () => memories, get: id => memories.find(m => m.id === id) }, inspectorEvents: { listAll: () => [], get: () => events } });
  const conv = await c.conversation(1);
  assert.match(conv.transcript.find(m => m.who === "mia").label, /modelo avanzado \(duda de confianza\)/);
});
