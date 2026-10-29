import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/memory/memory-store.js";
import { buildOnboardingDecision, operationsMemoryFromSale, ONBOARDING_COMPLETE_TEXT } from "../src/operations/onboarding-service.js";

// Caso real 19-oct: cliente en Cobranza contesta "ok" y Mia repetía "Listo, ya tengo los datos…".
// Causa: cada mensaje volvía a guardar el expediente en memoria solo con los documentos y
// borraba las banderas de validación, vigencia y pago.
const saleInPayment = {
  sale_id: "MART-9", status: "payment_requested", queue: "payment",
  validation: { approved: true }, validity: { confirmed: true }, payment: { requested: true },
  documents: { complete: true, missing: [], checklist: { received_count: 3, required_count: 3 } },
};

test("re-guardar el expediente desde la conversación conserva el estado de cobranza", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-cobranza-"));
  const memories = new MemoryStore(path.join(dir, "memory.json"));
  await memories.merge(1, { sales_cycle: { authorized: true }, operations: { ...operationsMemoryFromSale(saleInPayment), onboarding_last_requested: "ine" } });
  // Lo que hace ensureAuthorizedSale con cada mensaje: un parche parcial del estado.
  await memories.merge(1, { operations: { sale_id: "MART-9", documents_complete: true } });
  const ops = memories.get(1).operations;
  assert.equal(ops.payment_requested, true);
  assert.equal(ops.validity_confirmed, true);
  assert.equal(ops.onboarding_last_requested, "ine");
});

test("cliente en cobranza dice ok: Mia no repite el aviso de expediente completo", () => {
  const memory = { sales_cycle: { authorized: true }, ultima_respuesta_agente: "Para continuar solo falta tu pago.", operations: operationsMemoryFromSale(saleInPayment) };
  const decision = buildOnboardingDecision(memory, "ok");
  assert.notEqual(decision.reply, ONBOARDING_COMPLETE_TEXT);
  assert.equal(decision.reply, "");
});

test("aunque falten las banderas, el estado/cola del expediente basta para no repetir el aviso", () => {
  for (const ops of [{ status: "payment_requested" }, { status: "validity_confirmed", queue: "payment" }, { status: "waiting_validation", queue: "validation" }]) {
    const memory = { sales_cycle: { authorized: true }, operations: { sale_id: "MART-9", documents_complete: true, ...ops } };
    assert.notEqual(buildOnboardingDecision(memory, "ok").reply, ONBOARDING_COMPLETE_TEXT, JSON.stringify(ops));
  }
});

test("en captura y sin aviso previo, sí se avisa una vez", () => {
  const memory = { sales_cycle: { authorized: true }, operations: { sale_id: "MART-9", documents_complete: true, status: "waiting_capture", queue: "capture" } };
  assert.equal(buildOnboardingDecision(memory, "listo").reply, ONBOARDING_COMPLETE_TEXT);
});
