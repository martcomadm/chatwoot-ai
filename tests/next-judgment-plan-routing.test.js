import test from "node:test";
import assert from "node:assert/strict";
import { detectQuestion, analyzeJudgment } from "../src/orchestrator/conversational-judgment.js";

test("interest in Plan 1 is not a services question", () => {
  assert.equal(detectQuestion("Me interesa el Plan 1"), null);
  assert.equal(analyzeJudgment("Me interesa el Plan 1", {}).directAnswer, null);
});

test("selection of Plan 1 is not a services question", () => {
  assert.equal(detectQuestion("Me quedo con el Plan 1"), null);
  assert.equal(detectQuestion("Sí quiero el Plan 1 solamente"), null);
});

test("real plan questions still route to services", () => {
  assert.equal(detectQuestion("¿Cuáles son los planes?")?.type, "services");
  assert.equal(detectQuestion("¿Qué incluye el Plan 1?")?.type, "services");
  assert.equal(detectQuestion("¿Qué servicios manejan?")?.type, "services");
});
