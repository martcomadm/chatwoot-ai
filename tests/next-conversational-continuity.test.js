import test from "node:test";
import assert from "node:assert/strict";
import { compactPlanRecommendation } from "../src/sales/progressive-disclosure.js";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";

test("weeks plus pension uses compact retirement-aware recommendation from structured need", () => {
  const memory = {
    sales_cycle: { authorized: false, stage: "interested" },
    commercial_need: { weeks: true, retirement: true, unknown: false },
  };
  const decision = compactPlanRecommendation(memory, "Quiero seguir cotizando semanas para mi próxima pensión");
  assert.ok(decision);
  assert.match(decision.reply, /futura pensión/i);
  assert.match(decision.reply, /\$1,100/);
  assert.doesNotMatch(decision.reply, /salario diario/i);
  assert.doesNotMatch(decision.reply, /prepare la cotización/i);
  assert.doesNotMatch(decision.reply, /inicie? el trámite/i);
});

test("process time question is answered directly without repeating requirements", () => {
  const flow = orchestrateConversation("vale el tramite cuanto tarda en procesarse?", {});
  assert.equal(flow.directRequest?.type, "process_time");
  assert.match(flow.directAnswer, /48 horas hábiles/i);
  assert.doesNotMatch(flow.directAnswer, /qué documentos|documentos se necesitan/i);
});

test("identity question answers Mia naturally even after prior presentation", () => {
  const flow = orchestrateConversation("ya me los dijiste, como dices que te llamas?", { presentacion_realizada: true });
  assert.equal(flow.directRequest?.type, "identity");
  assert.match(flow.directAnswer, /Me llamo Mia/i);
  assert.match(flow.directAnswer, /asistente virtual de MARTCOM/i);
  assert.doesNotMatch(flow.directAnswer, /ya lo mencioné/i);
});
