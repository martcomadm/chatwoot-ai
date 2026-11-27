import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SaleStore, publicSale } from "../src/operations/sale-store.js";

test("publicSale oculta documentos base64 sin modificar el expediente guardado", () => {
  const sale = {
    sale_id: "MART-1",
    validity: { document_name: "vigencia.pdf", document_base64: "A".repeat(4000) },
    payment: { accounts_image_name: "cuentas.jpg", accounts_image_base64: "B".repeat(800), amount: 1500 },
  };
  const view = publicSale(sale);
  assert.equal(view.validity.document_base64, null);
  assert.equal(view.validity.document_pending, true);
  assert.equal(view.validity.document_bytes, 3000);
  assert.equal(view.validity.document_name, "vigencia.pdf");
  assert.equal(view.payment.accounts_image_base64, null);
  assert.equal(view.payment.accounts_image_pending, true);
  assert.equal(view.payment.amount, 1500);
  assert.equal(sale.validity.document_base64.length, 4000, "el original no cambia");
  assert.doesNotMatch(JSON.stringify(view), /AAAA|BBBB/);
});

test("publicSale deja intacto un expediente sin documentos pendientes", () => {
  const sale = { sale_id: "MART-2", validity: { document_base64: null }, payment: {} };
  assert.deepEqual(publicSale(sale), sale);
  assert.equal(publicSale(null), null);
});

test("findByConversationId devuelve el expediente más reciente de la conversación", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-find-"));
  const store = new SaleStore(path.join(dir, "sales.json"));
  const older = store.create({ conversation_id: 55 });
  store.create({ conversation_id: 56 });
  await new Promise(resolve => setTimeout(resolve, 5));
  const newer = store.create({ conversation_id: 55 });
  assert.equal(store.findByConversationId(55).sale_id, newer.sale_id);
  assert.notEqual(store.findByConversationId(55).sale_id, older.sale_id);
  assert.equal(store.findByConversationId(999), null);
  const found = store.findByConversationId(55);
  found.status = "mutado";
  assert.notEqual(store.get(newer.sale_id).status, "mutado", "devuelve una copia");
});
