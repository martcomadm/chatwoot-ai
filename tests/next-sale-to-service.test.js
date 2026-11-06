import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { CaseStore } from "../src/operations/customer-service/case-store.js";
import { CustomerService } from "../src/operations/customer-service/customer-service.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { OpsNotifier } from "../src/operations/notifications/ops-notifier.js";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-svc-"));
  const users = new UserStore(path.join(dir, "u.json"));
  for (const [username, areas, cw] of [["vale.valida", ["validacion"]], ["ana.atencion", ["atencion"], 41], ["cap.tura", ["captura"]], ["sergio.super", ["supervision"]]]) users.create({ username, name: username, areas, password: "clave-segura-123", chatwoot_agent_id: cw });
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(saleStore);
  const assigned = [];
  const chatwoot = { async assignConversation(id, agent) { assigned.push([id, agent]); }, async getAllMessages() { return { payload: [] }; } };
  const customerService = new CustomerService({ store: new CaseStore(path.join(dir, "c.json")), users, chatwoot, isOpen: () => true });
  return { dir, users, saleStore, workflow, customerService, chatwoot, assigned };
}

test("flujo: enviar con motivo, queda en pausa y Atención lo regresa a la misma área o a otra", () => {
  const { workflow, saleStore } = setup();
  const sale = workflow.openAuthorizedSale({ conversation_id: 9, customer: { nombre: "Rosa" }, sale: { plan: "plan_1", authorized: true } });
  assert.throws(() => workflow.sendToService(sale.sale_id, {}), /motivo/);
  const sent = workflow.sendToService(sale.sale_id, { reason: "Semanas que no aparecen", area: "captura", by: "Cap" });
  assert.equal(sent.service.open, true);
  assert.equal(sent.queue, "capture");
  assert.throws(() => workflow.sendToService(sale.sale_id, { reason: "otra vez" }), /ya está/);
  const back = workflow.returnFromService(sale.sale_id, { target: "origin", note: "Ya se le explicó", by: "Ana" });
  assert.equal(back.service.open, false);
  assert.equal(back.queue, "capture");
  assert.equal(back.events.at(-1).type, "service.returned");
  // A otra área: se mueve y se reinicia lo posterior.
  saleStore.update(sale.sale_id, { status: "waiting_validity", queue: "validity", validation: { ...back.validation, approved: true } }, "x");
  workflow.sendToService(sale.sale_id, { reason: "Duda de datos", area: "vigencia" });
  const moved = workflow.returnFromService(sale.sale_id, { target: "capture", note: "Corregir CURP", by: "Ana" });
  assert.equal(moved.queue, "capture");
  assert.equal(moved.service.open, false);
  assert.equal(moved.service.returned_to, "capture");
});

test("API: Validación lo envía (caso por rotación y en Chatwoot); el área no lo mueve; Atención lo regresa y vuelve con Mia", async t => {
  const env = setup();
  const sale = env.workflow.openAuthorizedSale({ conversation_id: 9, customer: { nombre: "Rosa" }, sale: { plan: "plan_1", authorized: true } });
  env.saleStore.update(sale.sale_id, { status: "waiting_validation", queue: "validation", capture: { ...sale.capture, completed_at: new Date().toISOString() } }, "x");
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore: env.saleStore, workflow: env.workflow, memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users: env.users, sessions: new SessionStore(path.join(env.dir, "se.json")), settings: new OpsSettingsStore(path.join(env.dir, "st.json"), path.join(env.dir, "img.bin")), audit: new OpsAuditStore(path.join(env.dir, "a.json")), customerService: env.customerService, chatwoot: env.chatwoot }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  const vale = await as("vale.valida"); const ana = await as("ana.atencion"); const cap = await as("cap.tura");
  assert.equal((await cap(`/operations/api/sales/${sale.sale_id}/service`, { reason: "x" })).status, 403, "no es su cola");
  assert.equal((await vale(`/operations/api/sales/${sale.sale_id}/service`, {})).status, 400);
  const sent = await vale(`/operations/api/sales/${sale.sale_id}/service`, { reason: "El cliente dice que ya tiene alta con otro patrón" });
  assert.equal(sent.status, 200);
  const caseId = sent.body.case_id;
  const c = env.customerService.store.get(caseId);
  assert.equal(c.kind, "escalated");
  assert.equal(c.sale_id, sale.sale_id);
  assert.match(c.reason, /^Validación: El cliente dice/);
  assert.equal(c.assignee.username, "ana.atencion");
  assert.deepEqual(env.assigned.at(-1), [9, 41]);
  // El área no puede moverlo mientras está en Atención.
  assert.equal((await vale(`/operations/api/sales/${sale.sale_id}/validation/check`, { key: "datos", checked: true })).status, 409);
  const detail = await ana(`/operations/api/cases/${caseId}`);
  assert.equal(detail.body.can.return, true);
  assert.equal(detail.body.service.queue_label, "Validación");
  assert.equal((await ana(`/operations/api/cases/${caseId}/return`, { target: "origin" })).status, 400, "pide nota");
  const back = await ana(`/operations/api/cases/${caseId}/return`, { target: "origin", note: "Se confirmó que ya no trabaja ahí" });
  assert.equal(back.status, 200);
  assert.equal(back.body.case.status, "resolved");
  assert.equal(back.body.sale.queue, "validation");
  assert.equal(back.body.sale.service.open, false);
  assert.deepEqual(env.assigned.at(-1), [9, 53], "la conversación regresa con Mia");
});

test("aviso: al regresarlo a la misma área se avisa a quien lo tiene o al área", () => {
  const users = { list: () => [{ username: "vale", areas: ["validacion"], active: true }] };
  const n = new OpsNotifier({ users, store: null });
  const plan = n.plan({ type: "service.returned", sale: { sale_id: "S1", queue: "validation", customer: { nombre: "Rosa" } }, details: { same_area: true, note: "Listo" } });
  assert.deepEqual(plan.to, ["vale"]);
  assert.match(plan.title, /regresó el expediente a Validación/);
});
