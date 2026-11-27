import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { detectQuestion, controlledAnswer } from "../src/orchestrator/conversational-judgment.js";

test("orchestrator answers what Plan 1 includes without describing Plan 2", () => {
  const request = detectDirectRequest("¿Qué incluye el Plan 1?");
  assert.equal(request?.plan, "plan_1");
  const answer = directAnswerText(request);
  assert.match(answer, /Plan 1/);
  assert.match(answer, /\$1,100/);
  assert.match(answer, /servicio médico/i);
  assert.match(answer, /semanas/i);
  assert.doesNotMatch(answer, /Plan 2/);
  assert.doesNotMatch(answer, /AFORE/);
});

test("judgment preserves Plan 1-specific question", () => {
  const question = detectQuestion("¿Qué incluye el Plan 1?");
  assert.equal(question?.type, "services_plan_1");
  const answer = controlledAnswer(question.answerKey, {});
  assert.match(answer, /Plan 1/);
  assert.doesNotMatch(answer, /Plan 2/);
});

test("Plan 2-specific question stays Plan 2-specific", () => {
  const request = detectDirectRequest("¿Qué incluye el Plan 2?");
  assert.equal(request?.plan, "plan_2");
  const answer = directAnswerText(request);
  assert.match(answer, /Plan 2/);
  assert.match(answer, /AFORE/);
  assert.match(answer, /INFONAVIT/);
});


test("registered salary question is answered directly instead of repeating plan pitch", () => {
  const request = detectDirectRequest("¿Y qué salario cotizado maneja ese plan?");
  assert.equal(request?.type, "registered_salary");
  assert.match(directAnswerText(request), /\$480 MXN/);
  const question = detectQuestion("¿Cuál es el salario diario registrado?");
  assert.equal(question?.type, "registered_salary");
  assert.match(controlledAnswer(question.answerKey, {}), /\$480 MXN/);
});
