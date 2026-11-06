import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { renderCustomerMessage } from "../src/operations/customer-messages.js";

// Baja por falta de pago (pedido 26-oct): Supervisión la da, el expediente se guarda aparte y Mia,
// si el cliente vuelve a escribir, le pide cubrir lo que no pagó.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-drop-"));
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(saleStore);
  const sale = workflow.openAuthorizedSale({ conversation_id: 9, contact_id: 300, customer: { nombre: "Rosa López", telefono: "+525512345678" }, sale: { plan: "plan_1", authorized: true } });
  return { dir, saleStore, workflow, sale };
}

test("flujo: solo con alta vigente; guarda el adeudo; reactivar regresa a donde estaba", () => {
  const { workflow, saleStore, sale } = setup();
  assert.throws(() => workflow.dropForNonPayment(sale.sale_id, { reason: "no pagó" }), /alta vigente/);
  saleStore.update(sale.sale_id, { status: "completed", queue: "completed", validity: { ...sale.validity, confirmed: true } }, "x");
  assert.throws(() => workflow.dropForNonPayment(sale.sale_id, {}), /motivo/);
  const dropped = workflow.dropForNonPayment(sale.sale_id, { reason: "No pagó octubre y noviembre", months: 2, by: "Sergio" });
  assert.equal(dropped.status, "dropped_nonpayment");
  assert.equal(dropped.queue, "dropped");
  assert.equal(dropped.debt.amount, 2200);
  assert.equal(dropped.debt.open, true);
  assert.throws(() => workflow.returnToStage(sale.sale_id, { target: "capture", reason: "x" }), /Reactivar/);
  assert.equal(saleStore.findDroppedByContact({ phone: "5512345678" }).sale_id, sale.sale_id);
  assert.equal(saleStore.findDroppedByContact({ contactId: 300 }).sale_id, sale.sale_id);
  const custom = setup();
  custom.saleStore.update(custom.sale.sale_id, { validity: { confirmed: true } }, "x");
  assert.equal(custom.workflow.dropForNonPayment(custom.sale.sale_id, { reason: "x", amount: 900 }).debt.amount, 900);
  const back = workflow.reactivateAfterPayment(sale.sale_id, { notes: "Pagó por transferencia", by: "Sergio" });
  assert.equal(back.status, "completed");
  assert.equal(back.queue, "completed");
  assert.equal(back.debt.settled, true);
  assert.equal(back.debt.open, false);
  assert.match(renderCustomerMessage("supervision.debt_settled", { sale: back }), /Confirmamos tu pago pendiente/);
});

test("API: Supervisión y Cobranza dan de baja y reactivan; otras áreas no", async t => {
  const env = setup();
  env.saleStore.update(env.sale.sale_id, { status: "completed", queue: "completed", validity: { confirmed: true } }, "x");
  const users = new UserStore(path.join(env.dir, "u.json"));
  users.create({ username: "sergio.super", name: "Sergio", areas: ["supervision"], password: "clave-segura-123" });
  users.create({ username: "cobra.nza", name: "Cobra", areas: ["cobranza"], password: "clave-segura-123" });
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore: env.saleStore, workflow: env.workflow, memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users, sessions: new SessionStore(path.join(env.dir, "se.json")), settings: new OpsSettingsStore(path.join(env.dir, "st.json"), path.join(env.dir, "img.bin")), audit: new OpsAuditStore(path.join(env.dir, "a.json")), chatwoot: {} }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  users.create({ username: "vale.valida", name: "Vale", areas: ["validacion"], password: "clave-segura-123" });
  const sup = await as("sergio.super"); const cob = await as("cobra.nza"); const val = await as("vale.valida");
  assert.notEqual((await val(`/operations/api/sales/${env.sale.sale_id}/supervision/drop`, { reason: "x" })).status, 200);
  // Cobranza ve los completados y las bajas.
  const me = await cob("/operations/api/me");
  assert.ok(me.body.visible_queues.includes("completed") && me.body.visible_queues.includes("dropped") && me.body.visible_queues.includes("payment"));
  const byCob = await cob(`/operations/api/sales/${env.sale.sale_id}/supervision/drop`, { reason: "No pagó noviembre" });
  assert.equal(byCob.status, 200);
  assert.equal(byCob.body.sale.queue, "dropped");
  assert.equal((await cob(`/operations/api/sales/${env.sale.sale_id}/supervision/reactivate`, { notes: "Pagó" })).body.sale.queue, "completed");
  const dropped = await sup(`/operations/api/sales/${env.sale.sale_id}/supervision/drop`, { reason: "No pagó", months: "1" });
  assert.equal(dropped.status, 200);
  assert.equal(dropped.body.sale.queue, "dropped");
  const back = await sup(`/operations/api/sales/${env.sale.sale_id}/supervision/reactivate`, { notes: "Pagó" });
  assert.equal(back.status, 200);
  assert.equal(back.body.sale.queue, "completed");
});

function processorFor({ workflow, saleStore }, { conversationId, contactId, assignee = 53, labels = [], memory = {}, content = "Hola, quiero volver a activar mi seguro", attachments = [] }) {
  const state = { sent: [], notes: [], events: [], memory: structuredClone(memory) };
  const m = { id: 900, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments, created_at: Math.floor(Date.now() / 1000) };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: conversationId, inbox_id: 7, meta: { assignee: { id: assignee }, sender: { id: contactId, phone_number: "+525512345678" } }, labels, messages: [m] }; }, async sendMessage(_i, t, priv) { (priv ? state.notes : state.sent).push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "¿Qué buscas principalmente?" }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type) { state.events.push(type); } },
    handoffRouter: {}, workflow,
  });
  return { state, run: () => p.process(conversationId, { ids: ["900"], webhookMessages: new Map([["900", m]]) }) };
}

test("Mia reconoce al cliente dado de baja (aunque escriba desde otra conversación o esté asignado) y le pide cubrir su adeudo", async () => {
  const env = setup();
  env.saleStore.update(env.sale.sale_id, { status: "completed", queue: "completed", validity: { confirmed: true } }, "x");
  env.workflow.dropForNonPayment(env.sale.sale_id, { reason: "No pagó octubre", months: 1 });
  // Conversación nueva, asignada a una persona y con etiqueta de cierre.
  const first = processorFor(env, { conversationId: 55, contactId: 300, assignee: 99, labels: ["cerrado"] });
  await first.run();
  assert.equal(first.state.sent.length, 1);
  assert.match(first.state.sent[0], /dada de baja por falta de pago de tu mensualidad del Plan 1 \(\$1,100\)\. Para reactivarla es necesario cubrir ese pago pendiente/);
  assert.match(first.state.notes[0], /^MÍA → COBRANZA/);
  // El expediente queda ligado a la conversación nueva.
  assert.equal(env.saleStore.get(env.sale.sale_id).conversation_id, 55);
  assert.ok(env.saleStore.get(env.sale.sale_id).debt.customer_contacted_at);
  // Un "Ok" después ya no repite el aviso; si pregunta cómo pagar, se le recuerda.
  const ok = processorFor(env, { conversationId: 55, contactId: 300, memory: first.state.memory, content: "Ok" });
  await ok.run();
  assert.deepEqual(ok.state.sent, []);
  const ask = processorFor(env, { conversationId: 55, contactId: 300, memory: first.state.memory, content: "¿A qué cuenta deposito?" });
  await ask.run();
  assert.match(ask.state.sent[0], /falta cubrir tu pago pendiente/);
  // Manda el comprobante.
  const proof = processorFor(env, { conversationId: 55, contactId: 300, memory: first.state.memory, content: "", attachments: [{ file_type: "image", file_name: "pago.jpg", data_url: "https://x/pago.jpg" }] });
  await proof.run();
  assert.match(proof.state.sent[0], /recibí tu comprobante/);
  assert.match(proof.state.notes[0], /envió un comprobante/);
  assert.ok(env.saleStore.get(env.sale.sale_id).debt.proof_received_at);
});
