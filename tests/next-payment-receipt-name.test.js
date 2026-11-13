import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ConversationProcessor, identityOnly } from "../src/core/conversation-processor.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { ChatwootWorkflowBridge } from "../src/operations/chatwoot-workflow-bridge.js";

// Caso real 21-oct: el cliente mandó su comprobante de pago y el expediente quedó con el nombre del
// beneficiario del depósito ("Jozic De Jesus M", la cuenta de MARTCOM).

test("lo que la IA lee de un comprobante no cambia los datos del cliente", () => {
  assert.deepEqual(identityOnly({ nombre: "Jozic De Jesus M", document_type: "other" }, {}), {});
  assert.deepEqual(identityOnly({ nombre: "Jozic De Jesus M", document_type: null }, { nombre: "Ana López" }), {});
  const ine = identityOnly({ nombre: "Ana López Pérez", document_type: "ine", ine_recibida: true, curp_valor: "X" }, { nombre: "Ana López" });
  assert.equal(ine.nombre, undefined, "el nombre que ya teníamos no se reemplaza");
  assert.equal(ine.ine_recibida, true);
  assert.equal(identityOnly({ nombre: "Ana López Pérez", document_type: "ine", ine_recibida: true }, {}).nombre, "Ana López Pérez");
});

test("desde la conversación solo se llenan datos vacíos del expediente", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-receipt-"));
  const wf = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  const sale = wf.openAuthorizedSale({ conversation_id: 9, customer: { nombre: "Ana López Pérez", curp: null }, sale: { plan: "plan_1", authorized: true } });
  const after = wf.syncDocuments(sale.sale_id, { customer: { nombre: "Jozic De Jesus M", curp: "XEXX010101HNEXXXA4" }, fillOnly: true });
  assert.equal(after.customer.nombre, "Ana López Pérez");
  assert.equal(after.customer.curp, "XEXX010101HNEXXXA4");
});

test("en Cobranza una imagen es el comprobante: no se lee con la IA", async () => {
  let visionCalls = 0;
  const m = { id: 990, message_type: 0, content: "", private: false, attachments: [{ id: 1, file_type: "image", data_url: "https://chat/r.jpg" }], sender: { type: "contact" }, sender_type: "Contact" };
  let mem = { presentacion_realizada: true, nombre: "Ana López Pérez", sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "S1", status: "payment_requested", queue: "payment", documents_complete: true }, ultima_respuesta_agente: "x" };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage() {}, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, n) { mem = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, handoffRouter: {}, workflow: null,
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "ok" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "", extractDocumentData: async () => { visionCalls++; return { nombre: "Jozic De Jesus M" }; } },
    inspectorEvents: { async record() {} },
  });
  await p.process(80, { ids: ["990"], webhookMessages: new Map([["990", m]]) });
  assert.equal(visionCalls, 0);
  assert.equal(mem.nombre, "Ana López Pérez");
});

test("Corregir nombre: Supervisión en cualquier etapa, Captura solo en captura; Mia usa el nombre nuevo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-receipt-"));
  const store = new SaleStore(path.join(dir, "s.json"));
  const wf = new SaleWorkflowEngine(store);
  const sale = wf.openAuthorizedSale({ conversation_id: 9, customer: { nombre: "Jozic De Jesus M", curp: "XEXX010101HNEXXXA4", nss: "12345678901" }, sale: { plan: "plan_1", authorized: true } });
  wf.completeCapture(sale.sale_id);
  assert.throws(() => wf.correctCustomerName(sale.sale_id, { nombre: "Ana López Pérez" }), /no permitido/);
  const fixed = wf.correctCustomerName(sale.sale_id, { nombre: "Ana López Pérez" }, { anyStage: true });
  assert.equal(fixed.customer.nombre, "Ana López Pérez");
  assert.equal(fixed.events.at(-1).type, "customer.name_corrected");
  let mem = { nombre: "Jozic De Jesus M" };
  const bridge = new ChatwootWorkflowBridge({ saleStore: { on() {} }, chatwoot: { async sendMessage() {} }, labels: {}, memories: { get: () => mem, async merge(_i, p) { mem = { ...mem, ...p }; } }, inspectorEvents: { async record() {} } });
  await bridge.handle({ type: "customer.name_corrected", sale: fixed, details: {} });
  assert.equal(mem.nombre, "Ana López Pérez");
  assert.equal(mem.primer_nombre, "Ana");
});
