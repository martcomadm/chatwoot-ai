import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { deriveCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { contextualPlanExplanation, effectivePlan, isInformationOpening, progressiveOpeningDecision } from "../src/sales/progressive-disclosure.js";
import { followUpMessage } from "../src/core/follow-up.js";
import { contextualNextStep } from "../src/core/fallback.js";
import { isAutoReply } from "../src/semantic/auto-reply.js";
import { checkReply } from "../src/ai/quality-checker.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Chats reales del 15 y 16 de octubre.

test("'pensionar me lo mejor pagado' cuenta como necesidad de pensión", () => {
  assert.equal(deriveCommercialNeed("Pues es pensionar me lo mejor pagado").retirement, true);
  assert.equal(deriveCommercialNeed("quiero jubilarme").retirement, true);
});

test("Karla: con AFORE/INFONAVIT o 'Mejor el plan 2', el plan vigente es el 2 (seguimientos y respaldo)", () => {
  assert.equal(analyzeNextSale("Mejor el plan 2", { sales_cycle: { recommended_plan: "plan_1" } }).patch.sales_cycle.selected_plan, "plan_2");
  const karla = { commercial_need: { afore_infonavit: true, weeks: true }, sales_cycle: { recommended_plan: "plan_1", pitched_plans: ["plan_1", "plan_2"], explained_plans: ["plan_2"] } };
  assert.equal(effectivePlan(karla), "plan_2");
  assert.match(followUpMessage(karla, 0), /Plan 2/);
  assert.match(contextualNextStep(karla), /Plan 2/);
});

test("Querétaro y Modalidad 40 reciben su respuesta", () => {
  assert.equal(detectDirectRequest("Solo una pregunta ustedes están en Querétaro?")?.type, "location");
  assert.equal(detectDirectRequest("¿Tienen oficina en Monterrey?")?.type, "location");
  assert.notEqual(detectDirectRequest("¿Son de confianza?")?.type, "location");
  assert.notEqual(detectDirectRequest("¿ya están en proceso?")?.type, "location");
  assert.equal(detectDirectRequest("Creo que mi mejor opción es la modalidad 40 busco una sugerencia mejor")?.type, "modality_40");
});

test("'Me parece bien', 'Si y gracias' y 'Si, dame información' tras la oferta = explicar el plan", () => {
  const memory = { commercial_need: { weeks: true }, sales_cycle: { pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "…el Plan 1 puede ser una opción… Si quieres, te explico cómo funciona y qué conviene revisar en tu caso antes de iniciar." };
  for (const text of ["Me parece bien", "Si y gracias", "Si, dame información"]) assert.match(contextualPlanExplanation(memory, text)?.reply || "", /El Plan 1 incluye/, text);
  assert.equal(contextualPlanExplanation(memory, "Gracias"), null);
});

test("aperturas: 'información por favor', 'Quiero informes en perdona' y la de revisar caso con NSS", () => {
  assert.equal(isInformationOpening("información por favor"), true);
  assert.equal(isInformationOpening("Quiero informes en perdona"), true);
  assert.match(progressiveOpeningDecision({}, "Información y revisar mi caso con mi NSS").reply, /revisar tu caso/);
});

test("respuestas automáticas de otros negocios se ignoran; 'No lo conozco' nunca es 'no era para nosotros'", () => {
  assert.equal(isAutoReply("Gracias por tu mensaje. Romas Tours y Angelitos Juguetones te agradecemos tu preferencia, en este momento no podemos responder, pero lo haremos lo antes posible."), true);
  assert.equal(isAutoReply("Gracias por tu mensaje, quiero afiliarme al IMSS"), false);
  assert.equal(isAutoReply("Muchas gracias"), false);
  assert.ok(checkReply("Parece que ese mensaje no era para nosotros.", { memory: {}, customerText: "No lo conozco" }).reasons.includes("fuera_de_tema_indebido"));
});

test("conocimiento: la Constancia de Situación Fiscal no es requisito inicial y el pago va después del alta", () => {
  assert.match(MARTCOM_KNOWLEDGE, /Constancia de Situación Fiscal NO se pide al inicio/);
  assert.match(MARTCOM_KNOWLEDGE, /después realiza su primer pago/);
  assert.doesNotMatch(MARTCOM_KNOWLEDGE, /^CURP, NSS, INE, Constancia de Situación Fiscal/m);
});
