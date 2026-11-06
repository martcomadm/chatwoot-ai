import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { CaseStore } from "../src/operations/customer-service/case-store.js";
import { CustomerService } from "../src/operations/customer-service/customer-service.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// Venta cerrada por Atención a Clientes (pedido 28-oct): el cliente se queda con Atención y Mia ya no sigue la venta.
test("Atención cierra la venta: Mia se calla, etiqueta 'venta', asignado a quien lo tiene; 'Regresar a Mia' lo deshace", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-ss-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "ana.atencion", name: "Ana Atención", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 41 });
  users.create({ username: "beto.atencion", name: "Beto Atención", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 42 });
  users.create({ username: "vale.valida", name: "Vale", areas: ["validacion"], password: "clave-segura-123" });
  const store = new CaseStore(path.join(dir, "cases.json"));
  const cw = { labels: ["cliente"], assigned: [], notes: [] };
  const chatwoot = {
    async assignConversation(id, agent) { cw.assigned.push([id, agent]); },
    async getLabels() { return { payload: [...cw.labels] }; }, async setLabels(_id, l) { cw.labels = [...l]; },
    async sendMessage(_id, text, priv) { if (priv) cw.notes.push(text); },
  };
  const pings = [];
  const service = new CustomerService({ store, users, chatwoot, notifier: { async notify(n) { pings.push(n); } } });
  const mem = {};
  const memories = { get: id => structuredClone(mem[id] || {}), async merge(id, patch) { mem[id] = { ...(mem[id] || {}), ...patch }; }, async set(id, v) { mem[id] = v; }, hasProcessed: () => false, async markProcessedMany() {} };
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories, inspectorEvents: { async record() {} }, buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit: new OpsAuditStore(path.join(dir, "a.json")), customerService: service, chatwoot }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  const c = await service.openCase({ conversation_id: 77, kind: "specialized", reason: "Quiere que le llamen", customer: { nombre: "Rosa" } });
  assert.equal(c.assignee.username, "ana.atencion");
  const ana = await as("ana.atencion"); const beto = await as("beto.atencion"); const vale = await as("vale.valida");
  assert.equal((await beto(`/operations/api/cases/${c.case_id}/close-sale`, { plan: "plan_1" })).status, 403, "no es su caso");
  assert.equal((await vale(`/operations/api/cases/${c.case_id}/close-sale`, { plan: "plan_1" })).status, 403, "otra área");
  const closed = await ana(`/operations/api/cases/${c.case_id}/close-sale`, { plan: "plan_2", note: "Cerró por llamada" });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.case.service_sale.active, true);
  assert.equal(closed.body.case.customer.plan, "plan_2");
  assert.equal(closed.body.case.events.at(-1).type, "case.sale_closed");
  assert.equal(mem[77].service_sale.active, true);
  assert.ok(cw.labels.includes("venta"));
  assert.deepEqual(cw.assigned.at(-1), [77, 41]);
  assert.match(cw.notes.at(-1), /^ATENCIÓN A CLIENTES CERRÓ LA VENTA \(Plan 2\)/);
  assert.equal((await ana(`/operations/api/cases/${c.case_id}/close-sale`, {})).status, 400, "no se cierra dos veces");

  // Mia no contesta aunque la conversación vuelva a quedar asignada a ella.
  const sent = []; const events = [];
  const m = { id: 1, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "¿Cuánto cuesta el plan 2?", attachments: [], created_at: Math.floor(Date.now() / 1000) };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 77, inbox_id: 7, meta: { assignee: { id: 53 }, sender: { id: 1 } }, labels: [], messages: [m] }; }, async sendMessage(_i, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } }, memories, agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x" }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type) { events.push(type); } }, handoffRouter: {},
  });
  await processor.process(77, { ids: ["1"], webhookMessages: new Map([["1", m]]) });
  assert.deepEqual(sent, []);
  assert.ok(events.includes("service_sale_skip"));

  // Caso atendido y el cliente vuelve a escribir: se abre caso nuevo con Ana (Mia no le contesta).
  service.setStatus(c.case_id, "resolved", { note: "Listo" });
  const again = await service.customerWrote(77, "Ya mandé mis documentos");
  assert.equal(again.kind, "returning");
  assert.equal(again.assignee.username, "ana.atencion");

  // Regresar a Mia: pide motivo, quita la etiqueta y reasigna a Mia.
  assert.equal((await ana(`/operations/api/cases/${c.case_id}/return-to-mia`, {})).status, 400);
  const back = await ana(`/operations/api/cases/${c.case_id}/return-to-mia`, { note: "No concretó, que Mia le dé seguimiento" });
  assert.equal(back.status, 200);
  assert.equal(mem[77].service_sale.active, false);
  assert.ok(!cw.labels.includes("venta"));
  assert.deepEqual(cw.assigned.at(-1), [77, 53]);
});
