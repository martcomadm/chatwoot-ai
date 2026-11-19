import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNextSale, detectAuthorization } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";

const memory = {
  sales_cycle: {
    stage: "interested",
    recommended_plan: "plan_1",
    selected_plan: "plan_1",
    interested: true,
    authorized: false,
  },
};

for (const phrase of [
  "Sí me interesa, empecemos el trámite",
  "si me interesa empezemos el tramite",
  "Me interesa, iniciemos el proceso",
  "Procedamos con el trámite",
]) {
  test(`authorizes natural start phrase: ${phrase}`, () => {
    assert.equal(detectAuthorization(phrase), true);
    const result = analyzeNextSale(phrase, memory);
    assert.equal(result.authorized, true);
    assert.equal(result.patch.sales_cycle.authorized, true);
    assert.equal(result.patch.sales_cycle.selected_plan, "plan_1");
    // commitmentDecision intentionally receives the pre-message state:
    // it decides whether THIS message changes interested -> authorized.
    const decision = commitmentDecision(memory, phrase);
    assert.equal(decision?.commitment, "authorized");
    assert.match(decision?.reply || "", /abrir tu expediente/i);
  });
}
