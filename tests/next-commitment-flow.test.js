import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";

const recommended = { sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", selected_plan: null, authorized: false } };

test("interest in a plan is not authorization", () => {
  const result = analyzeNextSale("Me interesa el Plan 1", recommended);
  assert.equal(result.authorized, false);
  assert.equal(result.patch.sales_cycle.authorized, false);
  const decision = commitmentDecision(result.patch, "Me interesa el Plan 1");
  assert.equal(decision.commitment, "interested");
  assert.doesNotMatch(decision.reply, /abrir tu expediente/i);
});

test("selecting a plan is not authorization", () => {
  const result = analyzeNextSale("Me quedo con el Plan 1", recommended);
  assert.equal(result.patch.sales_cycle.selected_plan, "plan_1");
  assert.equal(result.patch.sales_cycle.authorized, false);
  const decision = commitmentDecision(result.patch, "Me quedo con el Plan 1");
  assert.equal(decision.commitment, "selected");
  assert.match(decision.reply, /seleccionado Plan 1/i);
  assert.doesNotMatch(decision.reply, /abrir tu expediente/i);
});

test("explicit process start after commercial context authorizes", () => {
  const memory = { sales_cycle: { stage: "interested", recommended_plan: "plan_1", selected_plan: "plan_1", authorized: false } };
  const result = analyzeNextSale("Sí, quiero iniciar el trámite", memory);
  assert.equal(result.patch.sales_cycle.authorized, true);
  assert.equal(result.patch.sales_cycle.selected_plan, "plan_1");
  const decision = commitmentDecision(result.patch, "Sí, quiero iniciar el trámite");
  assert.equal(decision.commitment, null);
});

test("authorization acknowledgement uses existing authorized memory only as onboarding boundary", () => {
  const before = { sales_cycle: { stage: "interested", recommended_plan: "plan_1", selected_plan: "plan_1", authorized: false } };
  const decision = commitmentDecision(before, "Sí, quiero iniciar el trámite");
  assert.equal(decision.commitment, "authorized");
  assert.match(decision.reply, /iniciar el trámite con Plan 1/i);
  assert.match(decision.reply, /abrir tu expediente/i);
});

test("generic alta interest during exploration is not formal authorization", () => {
  const result = analyzeNextSale("Quiero darme de alta", { sales_cycle: { stage: "exploring", authorized: false } });
  assert.equal(result.patch.sales_cycle.authorized, false);
});
