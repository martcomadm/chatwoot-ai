import test from "node:test";
import assert from "node:assert/strict";
import { progressiveOpeningDecision, compactPlanRecommendation, disclosureViolations, customerAskedCommercialDetails } from "../src/sales/progressive-disclosure.js";

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

test("first Plan 1 recommendation is compact and resumes pending name", () => {
  const memory = {
    nombre: null,
    ultima_pregunta: "nombre",
    necesidad_principal: "servicio médico",
    sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", authorized: false },
  };
  const d = compactPlanRecommendation(memory, "Lo quiero principalmente por el servicio médico");
  assert.ok(d);
  assert.equal(d.question_key, "nombre");
  assert.match(d.reply, /Plan 1/i);
  assert.match(d.reply, /\$1,100/);
  assert.match(d.reply, /servicio médico/i);
  assert.match(d.reply, /semanas cotizadas/i);
  assert.match(d.reply, /beneficiarios/i);
  assert.match(d.reply, /nombre completo/i);
  assert.doesNotMatch(d.reply, /\$480|salario diario|48 horas|documentación|5\.15/i);
});

test("first Plan 2 recommendation is compact", () => {
  const memory = {
    necesidad_principal: "AFORE e INFONAVIT",
    sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_2", authorized: false },
  };
  const d = compactPlanRecommendation(memory, "También me interesa AFORE e INFONAVIT");
  assert.ok(d);
  assert.match(d.reply, /Plan 2/i);
  assert.match(d.reply, /\$1,500/);
  assert.match(d.reply, /AFORE/i);
  assert.match(d.reply, /INFONAVIT/i);
  assert.doesNotMatch(d.reply, /5\.15|\$480|48 horas|incapacidades/i);
});

test("explicit detail question is never replaced by compact recommendation", () => {
  const memory = {
    necesidad_principal: "servicio médico",
    sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", authorized: false },
  };
  assert.equal(compactPlanRecommendation(memory, "¿Cuál es el salario diario y cuánto tarda?"), null);
});

test("compact recommendation does not repeat an already resolved pending question", () => {
  const memory = {
    nombre: "Juan Pérez",
    ultima_pregunta: "nombre",
    resolved_questions: ["nombre"],
    necesidad_principal: "servicio médico",
    sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", authorized: false },
  };
  const d = compactPlanRecommendation(memory, "Busco servicio médico");
  assert.ok(d);
  assert.equal(d.question_key, null);
  assert.doesNotMatch(d.reply, /nombre completo/i);
});
