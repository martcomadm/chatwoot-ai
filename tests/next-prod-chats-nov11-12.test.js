// Export del 11 al 12-nov (240 conversaciones).
import test from "node:test";
import assert from "node:assert/strict";
import { acceptsCallOffer, callOfferReply, acceptsAdvisorOffer, callRequest } from "../src/core/human-request.js";
import { detectDirectRequest, orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { FACT_LOCKED_TYPES } from "../src/core/deterministic-decision-policy.js";
import { deferralDecision, detectDeferral, gotJob } from "../src/sales/customer-deferral.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { affirmsWithDocuments } from "../src/sales/start-confirmation.js";
import { buildOnboardingDecision, DOCS_LATER_TEXT } from "../src/operations/onboarding-service.js";
import { INFONAVIT_CREDIT_PAYMENT_TEXT } from "../src/sales/infonavit-credit.js";

const P1 = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "Claro. El Plan 1 incluye… ¿Quieres que iniciemos tu trámite?" };
const P2 = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_2", explained_plans: ["plan_2"], pitched_plans: ["plan_2"] }, ultima_respuesta_agente: "Claro. El Plan 2 cuesta $1,500 MXN… ¿Quieres que iniciemos tu trámite?" };

test("ofertas de llamada de la IA o del equipo: el 'sí' registra la llamada con la hora propuesta (#11638, #11649)", () => {
  const team = "De acuerdo, con gusto podemos agendar una llamada el día de mañana a partir de las 10:00 am, para poder aclarar todas tus dudas. ¿Estás de acuerdo?";
  const a = acceptsCallOffer("Si deacuerdo muchas grasias", team);
  assert.deepEqual(a, { time: "manana a partir de las 10:00 am", proposed: true });
  assert.match(callOfferReply(a), /tu horario \(manana a partir de las 10:00 am\)/);
  assert.ok(acceptsCallOffer("Claro", "¿Te parece bien que un asesor te llame mañana a partir de las 10:00 a.m. para aclarar todas tus dudas?"));
  assert.deepEqual(acceptsCallOffer("sí", "¿Prefieres que un asesor te llame unos minutos?"), { time: null });
  // "Ok checo las recomendaciones" (#11617) no acepta la llamada; es revisar por su cuenta.
  assert.equal(acceptsCallOffer("Ok checo las recomendaciones", "…¿prefieres que un asesor te llame unos minutos? Dime sí…"), null);
  assert.equal(detectDeferral("Ok checo las recomendaciones"), "later");
  // "Puedo comunicarte con un asesor…" → "Si me interesa la asesoría" (#11645).
  assert.equal(acceptsAdvisorOffer("Si me interesa la asesoría", "Puedo comunicarte con un asesor para que revise tu caso y te oriente."), true);
  // "¿me las podrían aclarar por medio de una llamada?" (#11633 recibió la lista de precios).
  assert.equal(callRequest("no sé si aquí mismo me las podrían aclarar por medio de una llamada y qué costo tiene"), true);
});

test("acepta con documentos después: abre el expediente (#11649); si ya aceptó y pospone, no se le exige la CURP (#11667)", () => {
  const text = "Ok muy bien...ahorita estoy en mi trabajo...puedo mandarte la documentacion mañana por la mañana";
  assert.equal(affirmsWithDocuments(text), true);
  assert.equal(deferralDecision(P2, text), null);
  assert.equal(commitmentDecision(P2, text)?.commitment, "authorized");
  const authorized = { sales_cycle: { authorized: true }, operations: { sale_id: "S", documents_complete: false, documents_missing: ["curp"], onboarding_next: "curp" }, ultima_respuesta_agente: "Para continuar con tu expediente, compárteme por favor la CURP del titular." };
  assert.equal(buildOnboardingDecision(authorized, "Me comunico mas tarde es q estoy entrando q trabajar gracias").reply, DOCS_LATER_TEXT);
  assert.match(deferralDecision(P1, "Es que no lo tengo ahorita estoy en el trabajo").reply, /Cuando tengas a la mano tu CURP, NSS e INE/);
  assert.equal(detectDeferral("Si entonses mañana boy air ala subdelegación para Ber que medisen y yo ya luego me contacto con usted"), "later");
});

test("ya consiguió trabajo: se despide con gusto y no se le insiste (#10444, #11669)", () => {
  for (const t of ["Buen día! Ya empecé a laborar. Si en algún otro momento necesito de su servicio, yo me comunico con ustedes.", "Disculpe ya me dieron de alta\nGracias", "ya conseguí trabajo"]) {
    assert.equal(gotJob(t), true, t);
    const r = deferralDecision(P1, t);
    assert.match(r.reply, /felicidades por tu trabajo/);
    assert.equal(r.deferral, "not_fit");
  }
  assert.equal(gotJob("Aun no déjeme pensar porque estoy por entrar a trabajar pero aun no se si me vallan a dar de alta"), false);
  assert.equal(gotJob("ya me dieron de alta con ustedes?"), false);
});

test("respuestas nuevas: asesoría gratis, retiro de AFORE, pago del crédito INFONAVIT, error en el número, concubina, 'cotisando'", () => {
  const key = t => detectDirectRequest(t)?.answerKey;
  assert.equal(key("Costo de la asesoría"), "advice_cost");
  assert.equal(key("Quiero retirar mi afore"), "afore_withdrawal");
  assert.equal(key("como hago el retiro por desempleo"), "afore_withdrawal");
  assert.notEqual(key("quiero aportar a mi afore"), "afore_withdrawal");
  assert.equal(key("Pagando este plan ya no pagaría el Infonavit a parte cierto"), "credit_payment");
  assert.equal(key("Les comentaba q en mi número avía un herror m dijeron q avía q arreglar"), "data_correction");
  assert.equal(key("Cómo puedo afilar a mi concubina?"), "beneficiary");
  assert.notEqual(key("Como pago menos ? Con un patron salario minimo o como profesionista ? Modalidad 10 ?"), "payment_method");
  for (const k of ["advice_cost", "afore_withdrawal", "credit_payment"]) assert.ok(FACT_LOCKED_TYPES.has(k), k);
  assert.match(orchestrateConversation("Quiero retirar mi afore", { presentacion_realizada: true }).directAnswer, /no hacemos retiros de AFORE/);
  assert.match(orchestrateConversation("Costo de la asesoría", P1).directAnswer, /La asesoría no tiene costo/);
  assert.equal(INFONAVIT_CREDIT_PAYMENT_TEXT.includes("¿Quieres que te comunique con un asesor?"), true, "el 'sí' pasa con un asesor");
});
