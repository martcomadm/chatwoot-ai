import test from "node:test";
import assert from "node:assert/strict";
import { contextualActivityPatch } from "../src/core/next-commercial-guard.js";
import { needGuardDecision } from "../src/sales/need-before-recommendation.js";

test("binds unemployed as activity when prior agent reply asked occupation", () => {
  const memory = {
    nombre: "Juan Pérez Martínez",
    primer_nombre: "Juan",
    edad: 48,
    ultima_pregunta: null,
    flujo: { siguiente_paso: null },
    ultima_respuesta_agente: "Juan, ¿a qué te dedicas actualmente?",
  };
  const patch = contextualActivityPatch("Estoy desempleado", memory);
  assert.equal(patch?.actividad, "desempleado");
  assert.deepEqual(patch?.resolved_questions, ["actividad"]);
});

test("activity plus demographics triggers deterministic commercial need question", () => {
  const memory = {
    nombre: "Juan Pérez Martínez",
    primer_nombre: "Juan",
    edad: 48,
    actividad: "desempleado",
    commercial_need: { service_medical: false, weeks: false, afore_infonavit: false, retirement: false },
    sales_cycle: { authorized: false },
  };
  const decision = needGuardDecision(memory, "Estoy desempleado");
  assert.equal(decision?.question_key, "necesidad_principal");
  assert.match(decision?.reply || "", /qué es lo más importante para ti/i);
  assert.doesNotMatch(decision?.reply || "", /plan\s*[12]/i);
});
