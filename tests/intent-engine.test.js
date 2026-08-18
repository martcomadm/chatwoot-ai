import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent/intent-engine.js";
import { planIntentFlow } from "../src/intent/flows.js";

test("detecta retiro de AFORE por fallecimiento", () => {
  const intent = classifyIntent("Quiero retirar el AFORE porque mi papá falleció");
  assert.equal(intent.id, "RETIRO_AFORE_FALLECIMIENTO");
  assert.ok(intent.confidence >= 0.9);
});

test("conserva intención específica ante respuesta corta", () => {
  const previous = classifyIntent("Q puedo hacer para retirar el aforé, ya q mi papá falleció");
  const next = classifyIntent("Sí", previous);
  assert.equal(next.id, "RETIRO_AFORE_FALLECIMIENTO");
});

test("flujo de fallecimiento no pide actividad ni CURP", () => {
  const planner = planIntentFlow({
    intent: { id: "RETIRO_AFORE_FALLECIMIENTO" },
    preguntas_realizadas: [],
    caso_fallecimiento: {
      afiliado_imss_al_fallecer: true,
      afore_contactada: true,
      pension_negada: true,
      motivo_negativa: "ser mayor de edad",
      beneficiarios: ["solicitante", "hermano"],
    },
  });
  assert.equal(planner.action, "transferir_orientacion_fallecimiento");
  assert.equal(planner.question_key, null);
});

test("detecta servicio médico", () => {
  assert.equal(classifyIntent("Solo quiero servicio médico").id, "SERVICIO_MEDICO");
});

test("detecta consulta de semanas", () => {
  assert.equal(classifyIntent("Quiero saber cuántas semanas cotizadas tengo").id, "CONSULTA_SEMANAS");
});
