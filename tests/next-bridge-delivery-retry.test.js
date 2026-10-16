import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { ChatwootWorkflowBridge } from "../src/operations/chatwoot-workflow-bridge.js";

function fixture({ failAttachments = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-bridge-"));
  const store = new SaleStore(path.join(dir, "sales.json"));
  const workflow = new SaleWorkflowEngine(store);
  const calls = { attachments: [], texts: [], events: [] };
  let remainingFailures = failAttachments;
  const chatwoot = {
    async sendMessage(id, content) { calls.texts.push({ id, content }); },
    async sendMessageWithAttachment(id, content, attachment) {
      if (remainingFailures > 0) { remainingFailures -= 1; throw new Error("Chatwoot 502: Bad Gateway"); }
      calls.attachments.push({ id, content, filename: attachment.filename });
    },
    async assignTeam() {},
  };
  const bridge = new ChatwootWorkflowBridge({
    saleStore: store, chatwoot, labels: {}, memories: { async merge() {} },
    inspectorEvents: { async record(_id, type, data) { calls.events.push({ type, data }); } },
  });
  return { store, workflow, bridge, calls };
}

function readyForValidity(workflow) {
  const sale = workflow.openAuthorizedSale({ conversation_id: 901, customer: { nombre: "Ana", curp: "CURP", nss: "NSS" }, sale: { plan: "plan_2", precio: 1500, authorized: true }, documents: { files: [{ id: "ine", type: "ine", name: "INE.pdf" }, { id: "csf", type: "csf", name: "CSF.pdf" }] } });
  workflow.completeCapture(sale.sale_id);
  for (const key of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, key, true, { by: "Validador" });
  return workflow.mustGet(sale.sale_id);
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("envío exitoso de vigencia: se entrega una vez y se borra el base64", async () => {
  const { store, workflow, bridge, calls } = fixture();
  bridge.start();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf", document_base64: Buffer.from("pdf").toString("base64"), document_content_type: "application/pdf" });
  await settle();
  assert.equal(calls.attachments.length, 1);
  const stored = store.get(sale.sale_id).validity;
  assert.equal(stored.delivered_to_customer, true);
  assert.equal(stored.document_base64, null);
});

test("si Chatwoot falla, la vigencia queda pendiente y el reintento la entrega", async () => {
  const { store, workflow, bridge, calls } = fixture({ failAttachments: 1 });
  bridge.start();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf", document_base64: Buffer.from("pdf").toString("base64"), document_content_type: "application/pdf" });
  await settle();
  let stored = store.get(sale.sale_id).validity;
  assert.equal(calls.attachments.length, 0);
  assert.equal(stored.delivered_to_customer, false);
  assert.equal(stored.delivery_started_at, null, "el envío fallido no debe quedar bloqueado");
  assert.match(stored.delivery_error, /502/);
  assert.equal(stored.delivery_attempts, 1);
  assert.ok(stored.document_base64, "el documento se conserva para reintentar");
  assert.ok(calls.events.some(event => event.type === "validity.document_delivery_failed"));
  assert.ok(!calls.events.some(event => event.type === "operations_customer_notification" && event.data.event === "validity.confirmed"));

  const results = await bridge.retryPendingDeliveries();
  assert.deepEqual(results.map(r => [r.kind, r.delivered]), [["validity", true]]);
  stored = store.get(sale.sale_id).validity;
  assert.equal(calls.attachments.length, 1);
  assert.equal(stored.delivered_to_customer, true);
  assert.equal(stored.document_base64, null);
  assert.equal(stored.delivery_error, null);
  assert.deepEqual(await bridge.retryPendingDeliveries(), [], "no se reenvía lo ya entregado");
});

test("el reintento respeta un envío en curso reciente", async () => {
  const { store, workflow, bridge, calls } = fixture();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf", document_base64: "cGRm" });
  const current = store.get(sale.sale_id);
  store.update(sale.sale_id, { validity: { ...current.validity, delivery_started_at: new Date().toISOString() } }, "test.in_flight", {});
  assert.deepEqual(await bridge.retryPendingDeliveries(), []);
  assert.equal(calls.attachments.length, 0);
});
