import test from "node:test";
import assert from "node:assert/strict";
import { progressiveOpeningDecision, disclosureViolations, customerAskedCommercialDetails } from "../src/sales/progressive-disclosure.js";

const fresh = { tiene_imss: null, sales_cycle: { stage: "exploring", authorized: false } };

test("generic IMSS information opening gets a short conversational response", () => {
  const d = progressiveOpeningDecision(fresh, "Hola quiero más información sobre la afiliación IMSS");
  assert.ok(d);
  assert.equal(d.question_key, "tiene_imss");
  assert.match(d.reply, /servicio médico/i);
  assert.match(d.reply, /actualmente cuentas con IMSS/i);
  assert.doesNotMatch(d.reply, /Plan 1|Plan 2|1,100|1,500|5\.15|48 horas|\$480/i);
});

test("catalog dump is rejected during a generic opening", () => {
  const reply = "Ofrecemos Plan 1 $1,100 y Plan 2 $1,500 con AFORE 5.15%, salario diario $480 y proceso de 48 horas.";
  const reasons = disclosureViolations(reply, { memory: fresh, combinedText: "Quiero información sobre afiliación IMSS" });
  assert.ok(reasons.includes("catalogo_completo_prematuro"));
  assert.ok(reasons.includes("precio_no_solicitado_en_apertura"));
  assert.ok(reasons.includes("detalle_operativo_prematuro"));
});

test("explicit price question allows prices", () => {
  const text = "¿Cuánto cuesta y qué planes tienen?";
  assert.equal(customerAskedCommercialDetails(text), true);
  assert.deepEqual(disclosureViolations("Plan 1 $1,100 y Plan 2 $1,500", { memory: fresh, combinedText: text }), []);
});

test("explicit AFORE/INFONAVIT question allows relevant detail", () => {
  const text = "¿Tienen algo con AFORE e INFONAVIT?";
  assert.equal(customerAskedCommercialDetails(text), true);
  assert.deepEqual(disclosureViolations("El Plan 2 incluye aportaciones AFORE e INFONAVIT.", { memory: fresh, combinedText: text }), []);
});

test("progressive opening does not override an already known IMSS answer", () => {
  const memory = { tiene_imss: false, sales_cycle: { stage: "exploring", authorized: false } };
  assert.equal(progressiveOpeningDecision(memory, "Quiero información sobre afiliación IMSS"), null);
});

test("progressive disclosure never applies after authorization", () => {
  const memory = { tiene_imss: null, sales_cycle: { stage: "authorized", authorized: true } };
  assert.equal(progressiveOpeningDecision(memory, "Quiero información sobre afiliación IMSS"), null);
});
