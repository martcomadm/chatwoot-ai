import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeNextSale,
  detectAuthorization,
  detectExplicitPlanSelection,
  detectPlanPreference,
  enforceAuthorizedHandoff,
} from "../src/sales/next-sales-engine.js";
import { mergeMemory } from "../src/ai/services.js";

const apply = (memory, text) => mergeMemory(memory, analyzeNextSale(text, memory).patch);

test("recommends Plan 1 for medical service and weeks", () => {
  assert.equal(detectPlanPreference("Quiero servicio médico y seguir cotizando semanas"), "plan_1");
});

test("recommends Plan 2 when AFORE is needed", () => {
  assert.equal(detectPlanPreference("También me interesa AFORE"), "plan_2");
});

test("recommends Plan 2 when INFONAVIT is needed", () => {
  assert.equal(detectPlanPreference("Quiero juntar puntos de Infonavit"), "plan_2");
});

test("explicit process authorization is detected", () => {
  assert.equal(detectAuthorization("Sí, quiero iniciar el trámite"), true);
  assert.equal(detectAuthorization("Adelante con el proceso"), true);
});

test("choosing a plan is interest/selection, not process authorization", () => {
  assert.equal(detectExplicitPlanSelection("Me quedo con el plan 2"), "plan_2");
  assert.equal(detectAuthorization("Me quedo con el plan 2"), false);
  assert.equal(detectAuthorization("Quiero el plan 2 pero primero explícame bien"), false);
});

test("thinking about it is not authorization", () => {
  assert.equal(detectAuthorization("Déjame pensarlo y te aviso más tarde"), false);
  assert.equal(detectAuthorization("Solo estoy preguntando"), false);
});

test("comparing both plans does not invent a recommendation", () => {
  assert.equal(detectPlanPreference("¿Qué diferencia hay entre plan 1 y plan 2?"), null);
});

test("rejecting AFORE does not recommend Plan 2", () => {
  assert.equal(detectPlanPreference("No me interesa AFORE, solo servicio médico"), "plan_1");
});

test("commercial state persists recommendation", () => {
  const memory = apply({}, "Quiero seguro médico y semanas cotizadas");
  assert.equal(memory.sales_cycle.recommended_plan, "plan_1");
  assert.equal(memory.sales_cycle.stage, "plan_recommended");
});

test("commercial state can move from Plan 1 to Plan 2 when need changes", () => {
  let memory = apply({}, "Quiero servicio médico");
  memory = apply(memory, "También quiero Infonavit");
  assert.equal(memory.sales_cycle.recommended_plan, "plan_2");
});

test("price objection moves to objection handling without authorizing", () => {
  const result = analyzeNextSale("Se me hace muy caro", { sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1" } });
  assert.equal(result.patch.sales_cycle.stage, "objection_handling");
  assert.equal(result.patch.sales_cycle.authorized, false);
  assert.equal(result.patch.sales_cycle.price_objection_count, 1);
});

test("interest is different from authorization", () => {
  const result = analyzeNextSale("Me interesa, quiero saber más", {});
  assert.equal(result.patch.sales_cycle.interested, true);
  assert.equal(result.patch.sales_cycle.authorized, false);
  assert.equal(result.patch.sales_cycle.stage, "interested");
});

test("plan selection persists while authorization remains false", () => {
  const memory = apply({}, "Me quedo con el Plan 2");
  assert.equal(memory.sales_cycle.selected_plan, "plan_2");
  assert.equal(memory.sales_cycle.interested, true);
  assert.equal(memory.sales_cycle.authorized, false);
});

test("authorization persists previously selected/recommended plan", () => {
  let memory = apply({}, "Me interesa AFORE e Infonavit");
  memory = apply(memory, "Sí, quiero iniciar el trámite");
  assert.equal(memory.sales_cycle.authorized, true);
  assert.equal(memory.sales_cycle.selected_plan, "plan_2");
  assert.equal(memory.sales_cycle.stage, "authorized");
});

test("authorized memory forces handoff even when model says no", () => {
  const decision = enforceAuthorizedHandoff(
    { reply: "Perfecto", handoff: false, question_key: "curp" },
    { sales_cycle: { authorized: true } },
  );
  assert.equal(decision.handoff, true);
  assert.equal(decision.question_key, null);
  assert.match(decision.handoff_reason, /autorizó iniciar/i);
});

test("non-authorized memory does not force handoff", () => {
  const original = { reply: "¿Qué necesitas?", handoff: false, question_key: "necesidad_principal" };
  const decision = enforceAuthorizedHandoff(original, { sales_cycle: { authorized: false } });
  assert.deepEqual(decision, original);
});

test("sales_cycle survives generic memory merge", () => {
  const memory = mergeMemory(
    { nombre: "Ana", sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1" } },
    { edad: 45, sales_cycle: { interested: true, stage: "interested" } },
  );
  assert.equal(memory.nombre, "Ana");
  assert.equal(memory.edad, 45);
  assert.equal(memory.sales_cycle.recommended_plan, "plan_1");
  assert.equal(memory.sales_cycle.interested, true);
  assert.equal(memory.sales_cycle.stage, "interested");
});
