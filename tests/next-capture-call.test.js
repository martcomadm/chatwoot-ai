import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { renderCustomerMessage } from "../src/operations/customer-messages.js";
import { buildOnboardingDecision, operationsMemoryFromSale, CALL_ACK_TEXT } from "../src/operations/onboarding-service.js";
import { canRunAction, canRequestCall } from "../src/operations/access/areas.js";

test("Captura solicita una llamada: Mia manda el mensaje y el expediente se queda en Captura", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-call-"));
  const wf = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  const sale = wf.openAuthorizedSale({ conversation_id: 4, customer: { nombre: "Enedino" }, sale: { plan: "plan_1", authorized: true } });
  const after = wf.requestCall(sale.sale_id, { note: "Confirmar datos de la INE" });
  assert.equal(after.queue, "capture");
  assert.equal(after.status, sale.status);
  assert.ok(after.capture.call_requested_at);
  assert.equal(after.events.at(-1).type, "capture.call_requested");
  assert.equal(renderCustomerMessage("capture.call_requested", { sale: after }), "Para continuar con tu trámite, un asesor de MARTCOM necesita comunicarse contigo por llamada. ¿En qué horario te podemos marcar a este número?");
  assert.equal(operationsMemoryFromSale(after).call_requested_at, after.capture.call_requested_at);
  assert.equal(canRunAction({ areas: ["captura"] }, "capture/call"), true);
  assert.equal(canRunAction({ areas: ["validacion"] }, "capture/call"), false);
  // Desde 22-oct: también en Validación, Vigencia y Cobranza (el expediente se queda en su etapa).
  wf.store.update(sale.sale_id, { status: "waiting_validation", queue: "validation" }, "x");
  const inValidation = wf.requestCall(sale.sale_id, { area: "validacion" });
  assert.equal(inValidation.queue, "validation");
  assert.equal(inValidation.capture.call_area, "validacion");
  wf.store.update(sale.sale_id, { status: "completed", queue: "completed" }, "x");
  assert.throws(() => wf.requestCall(sale.sale_id), /no permitido/);
});

test("la respuesta del cliente con su horario se agradece una sola vez", () => {
  const ops = { sale_id: "S1", documents_complete: false, documents_missing: ["curp"], onboarding_next: "curp", call_requested_at: new Date().toISOString() };
  const memory = { sales_cycle: { authorized: true }, operations: ops };
  assert.equal(buildOnboardingDecision(memory, "A las 5 de la tarde").reply, CALL_ACK_TEXT);
  assert.notEqual(buildOnboardingDecision({ ...memory, call_ack_at: new Date(Date.now() + 1000).toISOString() }, "ok").reply, CALL_ACK_TEXT);
  assert.notEqual(buildOnboardingDecision(memory, "XEXX010101HNEXXXA4").reply, CALL_ACK_TEXT, "si manda la CURP, se procesa la CURP");
});

test("Solicitar llamada: el área que tiene el expediente o Supervisión; Observador no", () => {
  const at = queue => ({ queue });
  assert.equal(canRequestCall({ areas: ["captura"] }, at("capture")), true);
  assert.equal(canRequestCall({ areas: ["validacion"] }, at("validation")), true);
  assert.equal(canRequestCall({ areas: ["vigencia"] }, at("validity")), true);
  assert.equal(canRequestCall({ areas: ["cobranza"] }, at("payment")), true);
  assert.equal(canRequestCall({ areas: ["validacion"] }, at("payment")), false, "no es su cola");
  assert.equal(canRequestCall({ areas: ["supervision"] }, at("validity")), true);
  assert.equal(canRequestCall({ areas: ["observador"] }, at("capture")), false);
  assert.equal(canRequestCall({ areas: ["supervision"] }, at("completed")), false);
});

test("API: Validación puede solicitar la llamada en su cola; Captura ya no cuando el expediente salió de Captura", async t => {
  const express = (await import("express")).default;
  const { UserStore } = await import("../src/operations/access/user-store.js");
  const { SessionStore } = await import("../src/operations/access/session-store.js");
  const { OpsSettingsStore } = await import("../src/operations/access/settings-store.js");
  const { OpsAuditStore } = await import("../src/operations/access/audit-store.js");
  const { createOperationsRouter } = await import("../src/operations/operations-router.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-call-api-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "vale.valida", name: "Vale", areas: ["validacion"], password: "clave-segura-123" });
  users.create({ username: "ana.captura", name: "Ana", areas: ["captura"], password: "clave-segura-123" });
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(saleStore);
  const sale = workflow.openAuthorizedSale({ conversation_id: 4, customer: { nombre: "Enedino" }, sale: { plan: "plan_1", authorized: true } });
  saleStore.update(sale.sale_id, { status: "waiting_validation", queue: "validation" }, "x");
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow, memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit: new OpsAuditStore(path.join(dir, "a.json")) }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  const vale = await as("vale.valida");
  const ok = await vale(`/operations/api/sales/${sale.sale_id}/call`, { note: "confirmar datos" });
  assert.equal(ok.status, 200);
  assert.equal(saleStore.get(sale.sale_id).capture.call_area, "validacion");
  const ana = await as("ana.captura");
  assert.notEqual((await ana(`/operations/api/sales/${sale.sale_id}/call`, {})).status, 200);
});
