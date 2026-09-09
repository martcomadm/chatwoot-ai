import test from "node:test";
import assert from "node:assert/strict";
import { directAnswerDecision, protectDeterministicDecision, isDeterministicDecision, stripDecisionMetadata } from "../src/core/deterministic-decision-policy.js";
import { needGuardDecision } from "../src/sales/need-before-recommendation.js";
import { compactPlanRecommendation } from "../src/sales/progressive-disclosure.js";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";

test("requirements becomes a deterministic direct answer", () => {
  const orchestration = orchestrateConversation("Cuales son los requisitos?", {});
  const decision = directAnswerDecision({ judgment: {}, orchestration });
  assert.equal(decision.__deterministic, true);
  assert.equal(decision.question_key, null);
  assert.match(decision.reply, /CURP/);
  assert.match(decision.reply, /NSS/);
  assert.match(decision.reply, /INE/);
  assert.match(decision.reply, /Constancia/);
  assert.match(decision.reply, /No necesitas enviarlos todavía/);
});

test("need guard is protected as deterministic decision", () => {
  const memory = {
    nombre: "Juan Pérez Martínez",
    primer_nombre: "Juan",
    edad: 48,
    actividad: "desempleado",
    commercial_need: { unknown: true },
    sales_cycle: { authorized: false },
  };
  const raw = needGuardDecision(memory, "Estoy desempleado");
  const decision = protectDeterministicDecision(raw, "need_guard");
  assert.equal(isDeterministicDecision(decision), true);
  assert.equal(decision.question_key, "necesidad_principal");
  assert.match(decision.reply, /qué es lo más importante/i);
  assert.doesNotMatch(decision.reply, /compartes un poco más sobre tu situación/i);
});

test("compact recommendation can be protected from fallback repair", () => {
  const memory = {
    sales_cycle: { authorized: false, recommended_plan: "plan_1" },
    necesidad_principal: "seguir cotizando semanas para mi próxima pensión",
    commercial_need: { weeks: true, retirement: true, unknown: false },
  };
  const raw = compactPlanRecommendation(memory, "Quiero seguir cotizando semanas para mi próxima pensión");
  const decision = protectDeterministicDecision(raw, "compact_recommendation");
  assert.equal(isDeterministicDecision(decision), true);
  assert.match(decision.reply, /futura pensión/i);
  assert.doesNotMatch(decision.reply, /¿Deseas que inicie el trámite/i);
  assert.doesNotMatch(decision.reply, /prepare la cotización/i);
});

test("internal deterministic metadata is removed before sending", () => {
  const clean = stripDecisionMetadata({ reply: "Hola", __deterministic: true, __source: "test", question_key: null });
  assert.deepEqual(clean, { reply: "Hola", question_key: null });
});
