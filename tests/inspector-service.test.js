import test from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, explainDecision, filterConversations } from "../src/inspector/inspector-service.js";

test("detecta contradicciones como alerta", () => {
  const alerts = buildAlerts({ contradicciones: ["edad conflictiva"], preguntas_realizadas: [] }, []);
  assert.equal(alerts.some(a => a.code === "memory_contradictions"), true);
});

test("explica decisión desde decision_state", () => {
  const result = explainDecision({ intent: { id: "PENSION", confidence: .9 }, flujo: { fase: "diagnostico" } }, [{ type: "decision_state", details: { planner: { action: "preguntar_edad", question_key: "edad" } } }]);
  assert.equal(result.action, "preguntar_edad");
  assert.equal(result.questionKey, "edad");
});

test("filtra conversaciones por asesor", () => {
  const items = [{ id: 1, asesor: "Alberto" }, { id: 2, asesor: "Pamela" }];
  assert.deepEqual(filterConversations(items, { advisor: "pamela" }).map(x => x.id), [2]);
});
