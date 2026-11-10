import test from "node:test";
import assert from "node:assert/strict";
import { reactivationReplyDecision } from "../src/sales/reactivation.js";
import { templateByName } from "../src/chatwoot/template-catalog.js";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { contextualPlanExplanation } from "../src/sales/progressive-disclosure.js";
import { orchestrateConversation, detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { FACT_LOCKED_TYPES } from "../src/core/deterministic-decision-policy.js";

// Export del 9 y 10-nov.
const PLAN = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] } };
const SEG4 = { ...PLAN, ultima_respuesta_agente: templateByName("seguimiento4").text };

test("a la plantilla: 'Sí me interesa' es interés (no una duda); '¿qué es martcom?' se explica", () => {
  assert.match(reactivationReplyDecision(SEG4, "Si me interesa").reply, /^¡Qué gusto! Te recuerdo: el Plan 1/);
  assert.match(reactivationReplyDecision(SEG4, "Sí").reply, /cuéntame cuál es tu duda/);
  assert.match(reactivationReplyDecision(SEG4, "Buenos días disculpe \nDe dónde o que es martcom").reply, /^¡Hola! Soy Mia/);
  assert.equal(reactivationReplyDecision(SEG4, "Buenos días"), null, "un saludo solo no es una duda");
});

test("posponer: 'por el momento no', 'esperemos al lunes', 'te envío mis datos el fin de semana'", () => {
  assert.equal(detectDeferral("Si pero por el momento no lo hare. Gracias"), "later");
  assert.equal(detectDeferral("Si por favor esperemos al lunes"), "later");
  assert.match(deferralDecision({ ...PLAN, sales_cycle: { recommended_plan: "plan_2" } }, "Si te envío mis datos de fin de semana\nOk se los envio en jueves o más tardar viernes").reply, /^Perfecto\. Cuando tengas a la mano tu CURP, NSS e INE/);
});

test("testimonios y respaldo; '¿qué nececito para los trámites?'; el plan que nombra", () => {
  const t = orchestrateConversation("Estaría bien ver tus testimonios", PLAN).directAnswer;
  assert.match(t, /página de Facebook, Consultoría en Afiliaciones Martcom.*5 años.*5,000 clientes/s);
  assert.ok(FACT_LOCKED_TYPES.has("testimonials"));
  assert.equal(detectDirectRequest("Que seguridad tengo que no me dan de baja después de pagar?")?.answerKey, "drop_guarantee");
  assert.equal(detectDirectRequest("Okey yo les a visosi me conviene  que nececito para los tramites")?.answerKey, "requirements");
  const d = contextualPlanExplanation({ sales_cycle: { recommended_plan: "plan_1", pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "Te recomiendo el Plan 1…" }, "Me interesa plan dos me das información x favor");
  assert.match(d.reply, /^Claro\. El Plan 2/);
  assert.match(contextualPlanExplanation({ sales_cycle: { recommended_plan: "plan_1", pitched_plans: ["plan_1"], infonavit_credit: true }, ultima_respuesta_agente: "x" }, "Me interesa plan dos me das información")?.reply || "Plan 1", /Plan 1/, "con crédito INFONAVIT el Plan 2 no aplica");
});
