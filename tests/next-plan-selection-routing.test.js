import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";

const memory = {
  sales_cycle: {
    stage: "plan_recommended",
    recommended_plan: "plan_1",
    selected_plan: null,
    interested: false,
    authorized: false,
  },
};

test("me quedo con Plan 1 is selection, not services catalog request", () => {
  assert.equal(detectDirectRequest("Me quedo con el Plan 1"), null);
  const analyzed = analyzeNextSale("Me quedo con el Plan 1", memory);
  assert.equal(analyzed.patch.sales_cycle.selected_plan, "plan_1");
  assert.equal(analyzed.patch.sales_cycle.authorized, false);
  const decision = commitmentDecision(analyzed.patch, "Me quedo con el Plan 1");
  assert.equal(decision.commitment, "selected");
  assert.match(decision.reply, /seleccionado Plan 1/i);
});

test("quiero Plan 1 solamente is selection, not services catalog request", () => {
  assert.equal(detectDirectRequest("Sí, quiero el Plan 1 solamente"), null);
  const analyzed = analyzeNextSale("Sí, quiero el Plan 1 solamente", memory);
  assert.equal(analyzed.patch.sales_cycle.selected_plan, "plan_1");
  assert.equal(analyzed.patch.sales_cycle.authorized, false);
});

test("actual question about plans remains a direct services request", () => {
  const request = detectDirectRequest("¿Cuáles son los planes que manejan?");
  assert.equal(request?.type, "services");
  assert.equal(request?.answerKey, "services");
});
