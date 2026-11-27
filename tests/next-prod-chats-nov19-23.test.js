import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest, orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { acceptsCallOffer } from "../src/core/human-request.js";
import { existingClient } from "../src/core/agent-ownership.js";
import { buildOnboardingDecision, declinesOnboarding } from "../src/operations/onboarding-service.js";
import { overviewChoiceText } from "../src/sales/need-menu.js";
import { deriveCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { progressiveOpeningDecision } from "../src/sales/progressive-disclosure.js";
import { withCallOffer } from "../src/core/conversation-processor.js";

const key = t => detectDirectRequest(t)?.answerKey || null;

test("respuestas directas que faltaban (export 19 al 23-nov)", () => {
  assert.equal(key("Hola buenas tardes. De que ciudad es la empresa?"), "location");
  assert.equal(key("Pero con 700 cuánto sale ahorita cotizo con 500 diarios tiene valides ante el seguro?"), "higher_salary");
  assert.equal(key("Cuántas semanas tiene un año"), "weeks_per_year");
  for (const t of ["Ok y cuanto tiempo tengo que pagar", "Por cuantos meses lic.", "Pero tengo que pagar por aproximadamente 7 años verdad?", "Eso es para el primer mes y como funciona con los sucesivos"]) assert.equal(key(t), "payment_duration", t);
  assert.equal(key("Cuantos meses con la misma rp?"), "same_company");
  assert.equal(key("Con esos 1100 cuanto c ganaria al mes"), "pension_general");
  assert.equal(key("Necesito mas información, no me es suficiente, de martcom que me puedes informar"), "about_us");
  assert.equal(orchestrateConversation("En cuanto tiempo quedaría pensionado", {}).directRequest.answerKey, "pension_general");
  assert.equal(orchestrateConversation("Pero para pensionarme cuantas semanas tendría que tener", {}).directRequest.answerKey, "pension_general");
  const multi = orchestrateConversation("Eso pagaría cada mes? Por cuantos meses lic.", {});
  assert.equal(multi.directRequest.answerKey, "payment_duration", "no se repite 'el pago es mensual'");
});

test("posponer y despedirse", () => {
  for (const t of ["Dejeme pensarlo un poco gracias por su atencio", "Deje pensarlo y le mando mensaje sii", "Eldejeme seguirle pensando", "Ok. Quedamos pendientes"]) assert.equal(detectDeferral(t), "later", t);
  const P = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, ultima_respuesta_agente: "¿Quieres que iniciemos tu trámite?" };
  assert.doesNotMatch(deferralDecision(P, "Deja y lo platico con mi pareja y te mando mensaje").reply, /CURP/);
  assert.doesNotMatch(deferralDecision({ ultima_respuesta_agente: "¿hace cuánto dejaste de cotizar?" }, "te mando mensaje mañana xq orita estoy trabajando").reply, /CURP|Plan 1/);
  assert.match(deferralDecision(P, "mañana te mando mis papeles").reply, /CURP/);
  for (const t of ["Okey gracias", "Está bien gracias"]) assert.equal(confirmsStart(t, P), false, t);
  assert.equal(confirmsStart("Si gracias", P), true);
});

test("llamada ya pedida, cliente que habla de su pago, resumen de planes, 'tener seguro'", () => {
  assert.equal(acceptsCallOffer("Ok gracias", "¡Perfecto! Le dejo tu horario a un asesor para que te marque a este número, y también el contexto de lo que platicamos para que no tengas que repetirlo."), null);
  assert.equal(existingClient("Hoy haré el pago acordado Yair"), true);
  assert.equal(existingClient("¿Dónde se hace el pago?"), false);
  assert.equal(overviewChoiceText("Te lo resumo para que elijas: … ¿Cuál te interesa más, el Plan 1 o el Plan 2?", "2"), "Me interesa el Plan 2");
  for (const t of ["Lo primero tener seguro", "Tener mi seguro", "Por lo pronto seguro por qué estoy tomando medicamentos"]) assert.equal(deriveCommercialNeed(t, {}).service_medical, true, t);
  assert.equal(deriveCommercialNeed("tengo seguro social", {}).service_medical, false);
  const hola = "¡Hola! Soy Mia de MARTCOM. Con gusto te ayudo. La afiliación puede ayudarte a contar con servicio médico del IMSS y continuar cotizando semanas. Para orientarte mejor, ¿actualmente cuentas con IMSS?";
  assert.equal(progressiveOpeningDecision({ ultima_respuesta_agente: hola }, "¡Hola! Quiero más información"), null, "no se saluda dos veces seguidas");
  assert.doesNotMatch(withCallOffer("Entiendo la duda. Si prefieres que una persona te atienda y resuelva tus dudas, ¿quieres que te comunique con un asesor?"), /dudas, Si te ayuda/);
});

test("expediente: aviso del NSS una sola vez, 'ok enterado', 'de cualquier manera'", () => {
  const nss = { sales_cycle: { authorized: true }, operations: { sale_id: "s", onboarding_next: "nss", documents_missing: ["nss"], nss_resolution: "lookup_by_curp" }, nss_resolution: "lookup_by_curp", ultima_respuesta_agente: "Para continuar con tu afiliación al IMSS solo necesitamos: CURP y Número de Seguro Social." };
  assert.equal(buildOnboardingDecision(nss, "Ola buenos días que cree que tube qué salir de urgencias murió mi hermana y llego asta fin de mes").reply, "");
  const curp = { sales_cycle: { authorized: true }, operations: { sale_id: "s", onboarding_next: "curp", documents_missing: ["curp", "nss"] }, ultima_respuesta_agente: "De acuerdo, quedamos pendientes de la documentación de tu hija. En cuanto la tengas, envíala por aquí y seguimos." };
  assert.equal(buildOnboardingDecision(curp, "Ok enterado  pendientes").reply, "");
  assert.equal(declinesOnboarding("Gracias Estoy buscando con recibo timbrados gracias de cualquier manera"), true);
});
