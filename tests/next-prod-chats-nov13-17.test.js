// Export del 13 al 17-nov (331 conversaciones).
import test from "node:test";
import assert from "node:assert/strict";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { detectClosing } from "../src/sales/customer-deferral.js";
import { needGuardDecision, deriveCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { buildOnboardingDecision, onboardingPrompt, DOCS_LATER_TEXT } from "../src/operations/onboarding-service.js";

const ASKED = { presentacion_realizada: true, tiene_imss: false, ultima_respuesta_agente: "Para orientarte mejor, ¿qué es lo más importante para ti con la afiliación: tener servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?" };

test("si ya se preguntó qué busca y contesta otra cosa, se presentan los dos planes en vez de repetir", () => {
  for (const text of ["Tengo 54 años", "No x ahora no imposible. Me dicen q hay una forma de pagar y tener servicio es lo q yo quiero", "Si gracias"]) {
    assert.equal(needGuardDecision(ASKED, text)?.plans_overview, true, text);
  }
  const ia = { ...ASKED, ultima_respuesta_agente: "Con gusto te ayudo. Para recomendarte la mejor opción, ¿qué buscas principalmente: servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?" };
  assert.equal(needGuardDecision(ia, "Tengo 54 años")?.plans_overview, true);
  assert.equal(deriveCommercialNeed("Tener cervicio medico").service_medical, true);
  assert.equal(detectClosing("Si gracias", { lastReply: ASKED.ultima_respuesta_agente }), false);
});

test("dónde o por qué medio se paga recibe la forma de pago; el costo por darse de alta recibe los honorarios", () => {
  for (const text of ["Donde se depocitar el pago mensual", "Disculpe porque medio se depositan los pagos", "Si pero no me respondió donde sería el primer pago", "Donde se paga"]) {
    assert.equal(detectDirectRequest(text)?.answerKey, "payment_method", text);
  }
  for (const text of [".a parte de la mensualidad cuanto hay que pagar por darme de alta", "Pero por darme de alta hay un costo que hay que cubrir a ustedes", "Lo anterior todo pero uds cuánto cobran por hacer tramite"]) {
    assert.equal(detectDirectRequest(text)?.answerKey, "fees", text);
  }
});

const sale = (next, last) => ({ sales_cycle: { authorized: true }, operations: { sale_id: "S1", onboarding_next: next, documents_missing: [next] }, ultima_respuesta_agente: last });

test("expediente: CURP o NSS incompletos, archivos ilegibles, cortesías y 'deme un tiempo' sin repetir la solicitud", () => {
  assert.match(buildOnboardingDecision(sale("curp", onboardingPrompt("curp")), "BACG730726MDFRR17").reply, /le falta al menos un carácter: debe tener 18/);
  assert.match(buildOnboardingDecision(sale("nss", onboardingPrompt("nss")), "1289660665").reply, /11 dígitos y el que me enviaste tiene 10/);
  const unread = buildOnboardingDecision(sale("nss", "¿Pudiste conseguir tu NSS? Si no lo tienes, dime y lo localizamos con tu CURP."), "").reply;
  assert.match(unread, /recibí tu archivo, pero no alcanzo a leer ahí tu NSS/);
  assert.equal(buildOnboardingDecision(sale("nss", unread), "").reply, "", "no se repite el mismo aviso");
  assert.equal(buildOnboardingDecision(sale("nss", onboardingPrompt("curp")), "").reply, onboardingPrompt("nss"), "si el archivo sí traía la CURP se pide lo siguiente");
  assert.equal(buildOnboardingDecision(sale("curp", "Perfecto, aquí la espero."), "Ok").reply, "");
  assert.equal(buildOnboardingDecision(sale("curp", "Gracias, ya le pasé tu respuesta al asesor y te llamará a este número. Cualquier cosa, aquí sigo."), "Ok grasias muy amable").reply, "");
  assert.equal(buildOnboardingDecision(sale("curp", onboardingPrompt("curp")), "Ok yo le aviso pf deme un tiempo para platicarlo con m familia").reply, DOCS_LATER_TEXT);
});
