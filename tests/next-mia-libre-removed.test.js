import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AREAS, AREA_KEYS, canSeeSale, canRequestCall, normalizeAreas } from "../src/operations/access/areas.js";
import { renderCustomerMessage, DEFAULT_CUSTOMER_MESSAGES } from "../src/operations/customer-messages.js";
import { saleInputFromMemory } from "../src/operations/sale-factory.js";

// 27-nov: se terminó la prueba de Mia libre. Todo queda en Mia normal: no hay reparto de chats nuevos, ni permiso,
// ni sección; los chats y expedientes que eran de Mia libre los trabajan las áreas normales.
test("ya no existe el permiso ni el reparto de Mia libre", () => {
  assert.ok(!AREA_KEYS.includes("mia_libre"));
  assert.ok(!AREAS.some(a => /libre/i.test(a.label)));
  assert.deepEqual(normalizeAreas(["captura", "mia_libre"]), ["captura"], "el permiso viejo se ignora");
  assert.equal(fs.existsSync(new URL("../src/core/mia-mode.js", import.meta.url)), false);
  const config = fs.readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
  assert.doesNotMatch(config, /MIA_LIBRE_SHARE/);
});

test("un expediente que era de Mia libre lo ve y lo trabaja Captura", () => {
  const sale = { sale_id: "s1", queue: "capture", origin: "mia_libre" };
  const captura = { areas: ["captura"] };
  assert.equal(canSeeSale(captura, sale), true);
  assert.equal(canRequestCall(captura, sale), true);
  assert.equal(canSeeSale({ areas: ["mia_libre"] }, sale), false);
});

test("los expedientes nuevos ya no se marcan como Mia libre y el aviso de Validación lleva los dos números", () => {
  const input = saleInputFromMemory({ conversationId: 9, memory: { mia_mode: "light", nombre: "Cliente Prueba", sales_cycle: { authorized: true, selected_plan: "plan_1" } } });
  assert.notEqual(input.origin, "mia_libre");
  const key = Object.keys(DEFAULT_CUSTOMER_MESSAGES).find(k => /📞[^\n]*\n📞/.test(DEFAULT_CUSTOMER_MESSAGES[k]));
  const text = renderCustomerMessage(key, { sale: { origin: "mia_libre", plan: "plan_1" }, details: {} });
  assert.equal((text.match(/📞/g) || []).length, 2);
});
