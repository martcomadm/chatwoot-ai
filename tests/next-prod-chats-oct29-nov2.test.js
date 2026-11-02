import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { acceptsAdvisorOffer } from "../src/core/human-request.js";
import { deferralDecision } from "../src/sales/customer-deferral.js";

// Chats reales del 29-oct al 2-nov: Mia vendió poco. Diagnóstico: pedía nombre, edad y actividad uno por uno
// antes de recomendar (muchos se iban ahí), explicaba el plan sin preguntar si iniciaban y no reconocía
// "Lo iniciamos" ni "prefiero que un asesor revise mi caso".
const key = t => detectDirectRequest(fixCommonTypos(t))?.answerKey || null;

function conversation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-funnel-"));
  const workflow = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  const state = { memory: {}, sent: [], ai: [] };
  let n = 0;
  const say = async content => {
    n++;
    const m = { id: n, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: Math.floor(Date.now() / 1000) };
    const before = state.sent.length;
    const p = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 }, sender: { id: 1 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge(_i, v) { state.memory = { ...state.memory, ...v }; }, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {},
      ai: { extractAmbiguous: async () => ({}), generateDecision: async (_c, _l, _m, planner) => { state.ai.push(planner); return { reply: "¿Me compartes tu nombre completo?", question_key: planner?.question_key || null }; }, repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
      inspectorEvents: { async record() {} }, handoffRouter: {}, workflow,
    });
    await p.process(5, { ids: [String(n)], webhookMessages: new Map([[String(n), m]]) });
    return state.sent.slice(before).join("\n");
  };
  return { state, say };
}

test("del anuncio a iniciar: sin pedir nombre, edad ni actividad", async () => {
  const c = conversation();
  assert.match(await c.say("¡Hola! Quiero más información"), /¿actualmente cuentas con IMSS\?/);
  const need = await c.say("No");
  assert.match(need, /servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT\?/);
  assert.doesNotMatch(need, /nombre/);
  assert.match(await c.say("Servicio médico"), /Plan 1.*¿Quieres que te explique cómo funciona\?/s);
  assert.match(await c.say("Si"), /¿Quieres que iniciemos tu trámite/);
  assert.match(await c.say("Ok"), /CURP/);
  assert.equal(c.state.memory.sales_cycle.authorized, true);
  assert.ok(!c.state.ai.some(p => ["nombre", "edad", "actividad"].includes(p?.question_key)));
});

test("frases que no se reconocían", () => {
  assert.equal(commitmentDecision({ sales_cycle: { selected_plan: "plan_2" } }, "Lo iniciamos")?.commitment, "authorized");
  assert.equal(commitmentDecision({ sales_cycle: { recommended_plan: "plan_1" } }, "2) si escojo el plan 1 después puedo migrar al 2 3) en que tiempo se tarda")?.commitment, undefined);
  assert.equal(acceptsAdvisorOffer("Porque mejor rrevisar mi caso para estar seguro", "¿Quieres que iniciemos tu trámite o prefieres que un asesor revise tu caso primero?"), true);
  assert.equal(key("No estoy esperando que me diga cuántas semanas yebo y cuántas faltan"), "weeks_review");
  assert.equal(key("Porfavor necesito mas información demi de como esta el caso"), "weeks_review");
  assert.equal(key("Y kisiera darme de alta k presios tiene"), "price");
  const m = { ultima_respuesta_agente: "¿Quieres que iniciemos tu trámite?", sales_cycle: { selected_plan: "plan_2" } };
  assert.equal(deferralDecision(m, "Aré todo lo posible por mandar documentos mañana")?.deferral, "start_later");
  assert.equal(deferralDecision(m, "Ok t parece si t los mando en un par de horas voy camino a casa")?.deferral, "start_later");
});

import { directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { CaptureReviewRouter } from "../src/operations/capture-review.js";
test("confirmado 2-nov: empresa asignada al afiliarse; revisión de semanas con Captura", async () => {
  assert.match(directAnswerText(detectDirectRequest("A qué nombre de empresa es la alta")), /variedad de empresas.*aleatoria.*vigencia/s);
  // Rotación entre capturistas activos con ID de Chatwoot.
  const assigned = []; const notes = [];
  const users = { list: () => [
    { username: "ana.captura", name: "Ana", areas: ["captura"], active: true, chatwoot_agent_id: 31 },
    { username: "beto.captura", name: "Beto", areas: ["captura"], active: true, chatwoot_agent_id: 32 },
    { username: "sin.id", name: "Sin ID", areas: ["captura"], active: true },
    { username: "vale", name: "Vale", areas: ["validacion"], active: true, chatwoot_agent_id: 40 },
  ] };
  const router = new CaptureReviewRouter({ users, chatwoot: { async assignConversation(id, a) { assigned.push([id, a]); } }, notifier: { async notify(n) { notes.push(n); } } });
  await router.route({ conversationId: 7 }); await router.route({ conversationId: 8 }); await router.route({ conversationId: 9 });
  assert.deepEqual(assigned, [[7, 31], [8, 32], [9, 31]]);
  assert.equal(notes[0].title, "Cliente quiere revisar sus semanas");
  assert.deepEqual(notes[0].to, ["ana.captura"]);
  // En la conversación: Mia avisa, deja nota y pasa con Captura.
  const c = conversation();
  const routed = [];
  const original = c.say;
  const sent = await (async () => {
    const { ConversationProcessor: P } = await import("../src/core/conversation-processor.js");
    const state = { sent: [], notes: [], memory: { ultima_respuesta_agente: "¿Quieres que te explique cómo funciona?" } };
    const m = { id: 1, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Solo quiero saber cuántas semanas tengo", attachments: [], created_at: 1 };
    const p = new P({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { (priv ? state.notes : state.sent).push(t); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x" }), repairDecision: async () => ({}), handoffSummary: async () => "resumen" },
      inspectorEvents: { async record() {} }, handoffRouter: {},
    });
    p.captureReview = { async route(x) { routed.push(x); return { agent: { name: "Ana" }, assigned: true }; } };
    await p.process(5, { ids: ["1"], webhookMessages: new Map([["1", m]]) });
    return state;
  })();
  assert.equal(routed.length, 1);
  assert.match(sent.sent[0], /equipo de Captura/);
  assert.match(sent.notes[0], /^MÍA → CAPTURA/);
  assert.equal(sent.memory.handoff.agent_name, "Ana");
  void original;
});
