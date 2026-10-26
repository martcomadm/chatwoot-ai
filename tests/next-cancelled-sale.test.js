import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { ChatwootWorkflowBridge } from "../src/operations/chatwoot-workflow-bridge.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { canRunAction, visibleQueues } from "../src/operations/access/areas.js";
import { memoryAfterCancellation } from "../src/operations/cancelled-sale.js";

// Cobranza cancela; el expediente pasa a Cancelados y, si el cliente vuelve, Mia lo atiende sin problema (26-oct).
const settle = () => new Promise(r => setTimeout(r, 20));

test("Cobranza puede cancelar y ve la pestaña de Cancelados", () => {
  const cob = { areas: ["cobranza"] };
  assert.equal(canRunAction(cob, "supervision/cancel"), true);
  assert.equal(canRunAction({ areas: ["captura"] }, "supervision/cancel"), false);
  assert.ok(visibleQueues(cob).includes("cancelled"));
});

test("al cancelar: memoria como prospecto, chat de regreso a Mia y sin etiquetas del trámite; si vuelve a aceptar, expediente nuevo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-cancel-"));
  const store = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(store);
  let memory = { nombre: "Rosa López", sale_id: null, sales_cycle: { authorized: true, stage: "authorized", selected_plan: "plan_1" }, operations: { onboarding_next: "nss" } };
  const calls = { assigned: [], labels: null };
  const bridge = new ChatwootWorkflowBridge({
    saleStore: store, labels: {}, miaAgentId: 53,
    chatwoot: { async sendMessage() {}, async assignTeam() {}, async assignConversation(id, agent) { calls.assigned.push([id, agent]); }, async getLabels() { return { payload: ["venta", "validacion", "cliente"] }; }, async setLabels(_id, l) { calls.labels = l; } },
    memories: { get: () => structuredClone(memory), async set(_i, v) { memory = v; }, async merge(_i, p) { memory = { ...memory, ...p }; } },
    inspectorEvents: { async record() {} },
  });
  bridge.start();
  const sale = workflow.openAuthorizedSale({ conversation_id: 77, customer: { nombre: "Rosa López" }, sale: { plan: "plan_1", authorized: true } });
  workflow.cancelSale(sale.sale_id, { reason: "No contestó", by: "Cobra" });
  await settle();
  assert.equal(store.get(sale.sale_id).queue, "cancelled");
  assert.equal(memory.sales_cycle.authorized, false);
  assert.deepEqual(memory.operations, {});
  assert.equal(memory.nombre, "Rosa López");
  assert.deepEqual(calls.assigned, [[77, 53]]);
  assert.deepEqual(calls.labels, ["cliente"]);
  const fresh = workflow.openAuthorizedSale({ conversation_id: 77, customer: { nombre: "Rosa López" }, sale: { plan: "plan_2", authorized: true } });
  assert.notEqual(fresh.sale_id, sale.sale_id);
  assert.equal(store.get(sale.sale_id).status, "cancelled");
});

test("Mia atiende al cliente de un expediente cancelado aunque la memoria y las etiquetas sigan del trámite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-cancel2-"));
  const store = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(store);
  const sale = workflow.openAuthorizedSale({ conversation_id: 78, customer: { nombre: "Rosa" }, sale: { plan: "plan_1", authorized: true } });
  workflow.cancelSale(sale.sale_id, { reason: "x" });
  const state = { sent: [], memory: { nombre: "Rosa López", presentacion_realizada: true, ultima_respuesta_agente: "Gracias. Ahora compárteme por favor el NSS del titular.", sale_id: sale.sale_id, sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: sale.sale_id, onboarding_next: "nss", documents_missing: ["nss"] } } };
  const m = { id: 1, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Hola, quisiera información del plan 2", attachments: [] };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 78, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: ["venta"], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Con gusto te explico el Plan 2.", question_key: null }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow,
  });
  await p.process(78, { ids: ["1"], webhookMessages: new Map([["1", m]]) });
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0], /Plan 2/);
  assert.doesNotMatch(state.sent[0], /NSS/);
  assert.equal(state.memory.sales_cycle.authorized, false);
  assert.equal(memoryAfterCancellation({ sale_id: "X" }).sales_cycle.cancelled_sale_id, "X");
});
