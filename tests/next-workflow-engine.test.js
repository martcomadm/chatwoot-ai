import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-next-"));
  const store = new SaleStore(path.join(dir, "sales.json"));
  return { store, workflow: new SaleWorkflowEngine(store) };
}

function createSale(workflow) {
  return workflow.openAuthorizedSale({ conversation_id: 101, customer: { nombre: "Ana" }, sale: { plan: "plan_2", precio: 1500, authorized: true } });
}

test("authorized sale enters capture queue", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  assert.equal(sale.status, "waiting_capture");
  assert.equal(sale.queue, "capture");
});

test("capture completion sends expediente to validation", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  workflow.startCapture(sale.sale_id, { id: 5, name: "Capturista" });
  const updated = workflow.completeCapture(sale.sale_id);
  assert.equal(updated.status, "waiting_validation");
  assert.equal(updated.queue, "validation");
});

test("validation requires all four checks", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  workflow.completeCapture(sale.sale_id);
  workflow.setValidationCheck(sale.sale_id, "datos", true);
  workflow.setValidationCheck(sale.sale_id, "alta", true);
  workflow.setValidationCheck(sale.sale_id, "documentos", true);
  const before = workflow.setValidationCheck(sale.sale_id, "revision_final", false);
  assert.equal(before.status, "validation_in_progress");
  const approved = workflow.setValidationCheck(sale.sale_id, "revision_final", true);
  assert.equal(approved.validation.approved, true);
  assert.equal(approved.status, "waiting_validity");
  assert.equal(approved.queue, "validity");
});

test("cannot confirm validity before validation approval", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  assert.throws(() => workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf" }), /no permitido/i);
});

test("validity requires document reference", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  workflow.completeCapture(sale.sale_id);
  for (const key of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, key, true);
  assert.throws(() => workflow.confirmValidity(sale.sale_id, {}), /documento/i);
});

test("payment cannot be requested until validity is confirmed", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  assert.throws(() => workflow.requestPayment(sale.sale_id), /no permitido/i);
});

test("full workflow reaches completed in strict order", () => {
  const { workflow } = fixture();
  const sale = createSale(workflow);
  workflow.startCapture(sale.sale_id, { name: "Capturista" });
  workflow.completeCapture(sale.sale_id);
  for (const key of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, key, true);
  workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf" });
  workflow.requestPayment(sale.sale_id);
  workflow.receivePayment(sale.sale_id);
  const completed = workflow.validatePayment(sale.sale_id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.queue, "completed");
  assert.equal(completed.payment.validated, true);
});

test("sale store persists expediente across restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-next-persist-"));
  const file = path.join(dir, "sales.json");
  const store1 = new SaleStore(file);
  const workflow = new SaleWorkflowEngine(store1);
  const sale = createSale(workflow);
  const store2 = new SaleStore(file);
  assert.equal(store2.get(sale.sale_id).customer.nombre, "Ana");
});
