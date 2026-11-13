// Export del 12 al 13-nov (238 conversaciones).
import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { FACT_LOCKED_TYPES } from "../src/core/deterministic-decision-policy.js";
import { saysStart, commitmentDecision } from "../src/sales/commitment-flow.js";
import { genericInterest } from "../src/sales/start-confirmation.js";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { detectScheduledStart } from "../src/sales/scheduled-start.js";
import { featureRejectionDecision, plan2OverBudget } from "../src/sales/feature-rejection.js";
import { medicalNotNeededDecision } from "../src/sales/progressive-disclosure.js";
import { needGuardDecision } from "../src/sales/need-before-recommendation.js";
import { callRequest } from "../src/core/human-request.js";

const P1 = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], pitched_plans: ["plan_1"] } };
const P2 = { presentacion_realizada: true, commercial_need: { afore_infonavit: true }, sales_cycle: { recommended_plan: "plan_2", explained_plans: ["plan_2"], pitched_plans: ["plan_2"] }, ultima_respuesta_agente: "Por lo que buscas, el Plan 2 es el indicado: $1,500 MXN mensuales…" };

test("cliente listo que se perdió (#11692): 'sí puedo iniciar hoy', 'son la mejor opción', 'me interesa mucho el servicio'", () => {
  assert.equal(saysStart("Si puedo iniciar mi trámite hoy mismo"), true);
  assert.equal(commitmentDecision(P2, "Si puedo iniciar mi trámite hoy mismo")?.commitment, "authorized");
  assert.equal(saysStart("¿Puedo iniciar mi trámite y pagar después?"), false, "pregunta con más contenido no es aceptar");
  assert.equal(genericInterest("Pero definitivamente, son la mejor opción para mí"), true);
  assert.equal(genericInterest("Me interesa mucho el servicio que ofrecen"), true);
  assert.equal(detectDirectRequest("Me interesa mucho el servicio que ofrecen"), null);
  assert.equal(detectDirectRequest("¿Qué servicios ofrecen?")?.answerKey, "services");
  // "Tengo algunos gastos… tengo que revisar mi presupuesto": sin dinero ahorita, se le ofrece programar el alta.
  assert.equal(detectDeferral("Tengo algunos gastos que tengo que cubrir en esta primera quincena y no sé si pueda iniciar mi trámite hoy. Tengo que revisar mi presupuesto"), "no_money");
});

test("acepta con fecha: 'me gustaría empezar en la quincena' (#11695)", () => {
  const s = detectScheduledStart("Me gustaría enpezar el la quincena para que mi aportación sean los días 15 de cada mes");
  assert.ok(s);
  assert.match(s.when, /quincena/);
});

test("el Plan 2 no le alcanza: se le ofrece el Plan 1 y ya no se le insiste con el 2 (#11699)", () => {
  for (const t of ["me explica que contiene el plan uno , que cuesta $1100 el otro rebasa mi presupuesto", "ya borre todo , no alcanzo el de $1500 , necesito información del otro paquete", "es que el plan 2 es de $1500 pesos, se eleva quinientos pesos a mi presuesto"]) {
    assert.equal(plan2OverBudget(P2, t), true, t);
    const d = featureRejectionDecision(P2, t);
    assert.equal(d.plan, "plan_1");
    assert.match(d.reply, /te conviene el Plan 1, de \$1,100 MXN mensuales/);
  }
  assert.equal(plan2OverBudget(P1, "no me alcanza"), false, "si ya está en el Plan 1 es la objeción de precio normal");
});

test("'no me interesa el servicio médico' no es despedida (#11637)", () => {
  const t = "No me interesa el servicio médico. De todos modos no sirve";
  assert.equal(deferralDecision(P1, t), null);
  assert.match(medicalNotNeededDecision(P1, t).reply, /seguir sumando semanas cotizadas para tu pensión/);
});

test("respuestas nuevas: horario, aportaciones completas o parciales, crédito INFONAVIT, estado de AFORE, pensión ya otorgada, 'le marco'", () => {
  const key = t => detectDirectRequest(t)?.answerKey;
  assert.equal(key("Ahorita en este momento no puedo atender..... Que horario es el que manejan"), "business_hours");
  assert.equal(key("En el plan 2 las aportaciones infonavit y afore son completas o parciales?"), "plan_2_contributions");
  assert.equal(key("En el plan 2 el cliente si puede solicitar un crédito de infonavit?"), "infonavit_credit_eligibility");
  assert.equal(key("Necesito recuperar mi estado de aforé"), "afore_statement");
  assert.equal(key("Soy jubilado desd2014 pero mi pensión salió muy baja ha consecuencia de falta de semanas cotizadas justicia por favor"), "pension_already_granted");
  assert.equal(key("Deme un momento y le marco gracias"), "contact_channels");
  assert.equal(deferralDecision(P1, "Deme un momento y le marco gracias"), null);
  for (const k of ["business_hours", "infonavit_credit_eligibility", "afore_statement", "pension_already_granted"]) assert.ok(FACT_LOCKED_TYPES.has(k), k);
  assert.equal(callRequest("Si me permites que sea personal mejor con un contacto"), true);
});

test("la pregunta de necesidad no se repite sin fin (#11719): a la tercera se presentan los dos planes", () => {
  const base = { presentacion_realizada: true, tiene_imss: false, ultima_respuesta_agente: "Queda aclarado." };
  assert.match(needGuardDecision(base, "Si dime").reply, /qué es lo más importante para ti/);
  const third = needGuardDecision({ ...base, need_discovery_asks: 2 }, "Si dime");
  assert.equal(third.plans_overview, true);
  assert.match(third.reply, /¿Cuál te interesa más, el Plan 1 o el Plan 2\?/);
});
