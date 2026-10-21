import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { renderCustomerMessage } from "../src/operations/customer-messages.js";
import { buildOnboardingDecision, operationsMemoryFromSale, CALL_ACK_TEXT } from "../src/operations/onboarding-service.js";
import { canRunAction } from "../src/operations/access/areas.js";

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
  wf.completeCapture && assert.throws(() => { wf.store.update(sale.sale_id, { status: "waiting_validation", queue: "validation" }, "x"); wf.requestCall(sale.sale_id); }, /no permitido/);
});

test("la respuesta del cliente con su horario se agradece una sola vez", () => {
  const ops = { sale_id: "S1", documents_complete: false, documents_missing: ["curp"], onboarding_next: "curp", call_requested_at: new Date().toISOString() };
  const memory = { sales_cycle: { authorized: true }, operations: ops };
  assert.equal(buildOnboardingDecision(memory, "A las 5 de la tarde").reply, CALL_ACK_TEXT);
  assert.notEqual(buildOnboardingDecision({ ...memory, call_ack_at: new Date(Date.now() + 1000).toISOString() }, "ok").reply, CALL_ACK_TEXT);
  assert.notEqual(buildOnboardingDecision(memory, "XEXX010101HNEXXXA4").reply, CALL_ACK_TEXT, "si manda la CURP, se procesa la CURP");
});
