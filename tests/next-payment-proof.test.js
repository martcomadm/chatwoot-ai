import test from "node:test";
import assert from "node:assert/strict";
import { paymentProofAttachment, proofKindOf } from "../src/operations/payment-proof.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

test("solo imágenes y PDF con URL cuentan como comprobante", () => {
  assert.equal(proofKindOf({ file_type: "image", data_url: "https://x.test/a.jpg" }), "image");
  assert.equal(proofKindOf({ file_type: "file", data_url: "https://x.test/pago.pdf" }), "pdf");
  assert.equal(proofKindOf({ file_type: "file", content_type: "application/pdf", data_url: "https://x.test/f" }), "pdf");
  assert.equal(proofKindOf({ file_type: "location", data_url: "https://maps.test/?q=1" }), null);
  assert.equal(proofKindOf({ file_type: "contact", data_url: "https://x.test/c.vcf" }), null);
  assert.equal(proofKindOf({ file_type: "file", data_url: "https://x.test/doc.docx" }), null);
  assert.equal(proofKindOf({ file_type: "fallback" }), null);
  assert.equal(proofKindOf({ file_type: "image", id: 4 }), null, "sin URL no hay comprobante verificable");
  assert.equal(proofKindOf({ file_type: "audio", data_url: "https://x.test/a.ogg" }), null);
});

test("paymentProofAttachment ignora adjuntos inválidos y toma el primer comprobante válido", () => {
  const proof = paymentProofAttachment([
    { id: 1, attachments: [{ id: 10, file_type: "location", data_url: "https://maps.test" }] },
    { id: 2, attachments: [{ id: 20, file_type: "image", data_url: "https://x.test/pago.png", file_name: "pago.png" }] },
  ]);
  assert.equal(proof.attachment_id, 20);
  assert.equal(proof.message_id, 2);
  assert.equal(proof.proof_name, "pago.png");
  assert.equal(paymentProofAttachment([{ id: 3, attachments: [{ file_type: "contact" }] }]), null);
});

function setup({ assigneeId, saleStatus = "payment_requested", attachments = [], content = "" }) {
  const calls = { sent: [], received: [], ai: 0, processed: [] };
  const message = { id: 501, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments };
  const conversation = { id: 900, inbox_id: 7, meta: { assignee: { id: assigneeId } }, labels: [], messages: [message] };
  const sale = { sale_id: "MART-1", conversation_id: 900, status: saleStatus };
  const aiProxy = new Proxy({}, { get: () => async () => { calls.ai += 1; return {}; } });
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion" }, operations: {} },
    chatwoot: {
      async getConversation() { return structuredClone(conversation); },
      async sendMessage(id, text) { calls.sent.push(text); },
      async getMessages() { return { payload: [] }; },
    },
    labels: { async mergeSafe() {} },
    memories: {
      get: () => ({}), async set() {}, async merge() {},
      hasProcessed: () => false,
      async markProcessedMany(_id, ids) { calls.processed.push(...ids); },
    },
    agentRotation: {},
    ai: aiProxy,
    inspectorEvents: { async record() {} },
    handoffRouter: {},
    workflow: {
      store: { findByConversationId: () => sale },
      receivePayment(id, payload) { calls.received.push({ id, payload }); return { ...sale, status: "payment_received" }; },
    },
  });
  return { processor, calls, snapshot: { ids: ["501"], webhookMessages: new Map([["501", message]]) } };
}

test("chat reasignado esperando pago: registra el comprobante y Mia no responde", async () => {
  const { processor, calls, snapshot } = setup({ assigneeId: 99, attachments: [{ id: 77, file_type: "image", data_url: "https://x.test/pago.jpg" }] });
  await processor.process(900, snapshot);
  assert.equal(calls.received.length, 1);
  assert.equal(calls.received[0].payload.attachment_id, 77);
  assert.deepEqual(calls.sent, []);
  assert.equal(calls.ai, 0);
  assert.deepEqual(calls.processed, [501]);
});

test("chat reasignado esperando pago con solo texto: no registra pago ni responde", async () => {
  const { processor, calls, snapshot } = setup({ assigneeId: 99, content: "ya pagué, ¿me confirmas?" });
  await processor.process(900, snapshot);
  assert.equal(calls.received.length, 0);
  assert.deepEqual(calls.sent, []);
  assert.equal(calls.ai, 0);
});

test("chat reasignado sin pago pendiente se ignora por completo", async () => {
  const { processor, calls, snapshot } = setup({ assigneeId: 99, saleStatus: "waiting_validation", attachments: [{ id: 77, file_type: "image", data_url: "https://x.test/pago.jpg" }] });
  await processor.process(900, snapshot);
  assert.equal(calls.received.length, 0);
  assert.deepEqual(calls.sent, []);
  assert.deepEqual(calls.processed, []);
});

test("chat asignado a NEXT: una ubicación no se registra como pago", async () => {
  const { processor, calls, snapshot } = setup({ assigneeId: 53, attachments: [{ id: 5, file_type: "location", data_url: "https://maps.test" }] });
  await processor.process(900, snapshot).catch(() => {});
  assert.equal(calls.received.length, 0);
});
