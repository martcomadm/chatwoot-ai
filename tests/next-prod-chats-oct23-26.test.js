import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { deferralDecision } from "../src/sales/customer-deferral.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { deriveCommercialNeed, suppressRecommendationWithoutNeed } from "../src/sales/need-before-recommendation.js";
import { compactPlanRecommendation } from "../src/sales/progressive-disclosure.js";
import { plausibleName } from "../src/semantic/name-validator.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { callRequest } from "../src/core/human-request.js";
import { specializedAdviceHandoff } from "../src/core/specialized-advice-handoff.js";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { buildOnboardingDecision, ONBOARDING_DECLINED_TEXT, COBRANZA_EXTENSION_TEXT, NSS_HELP_TEXT } from "../src/operations/onboarding-service.js";
import { hasActiveInfonavitCredit } from "../src/sales/infonavit-credit.js";
import { agentStartedConversation, mentionsOwnAdvisor, existingClient } from "../src/core/agent-ownership.js";
import { analyzePatience } from "../src/semantic/conversational-patience.js";

// Chats reales del 23 al 26 de octubre (export del Inspector).
const key = t => detectDirectRequest(fixCommonTypos(t))?.answerKey || null;

test("frases que no son nombres ya no se guardan como nombre", () => {
  for (const t of ["Déjeme lo checo y le confirmo", "Dejame checo...", "Q prosige", "Q devo de aser", "Ambos cosas", "Todo lo mencionado", "Permítame Pokito", "Mari estoy viendo opciones"]) assert.equal(plausibleName(t), false, t);
  for (const t of ["Rosa cruz altamirano", "Clara Domingo Pérez", "Marco Antonio Ruiz", "Lucero"]) assert.equal(plausibleName(t), true, t);
});

test("chats que abrió un asesor (Isela Galicia) son suyos: Mia no contesta", async () => {
  const human = { id: 1, message_type: 1, sender_type: "User", sender: { type: "user", id: 77 }, sender_id: 77, private: false, content: "Muchas gracias por recibir mi llamada, por este medio seguiremos nuestra comunicación.", created_at: 100 };
  const customer = { id: 2, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Si", created_at: 200, attachments: [] };
  assert.equal(agentStartedConversation({ messages: [human, customer] }, 53), true);
  // Si Mia ya participó, o el chat lo abrió el cliente, no aplica.
  assert.equal(agentStartedConversation({ messages: [{ ...customer, created_at: 50 }, human] }, 53), false);
  assert.equal(agentStartedConversation({ messages: [human, { ...human, id: 3, sender_id: 53, sender: { type: "user", id: 53 } }, customer] }, 53), false);

  const state = { sent: [], events: [] };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 70, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [human, customer] }; }, async sendMessage(_i, t) { state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "¿Cuál es tu necesidad principal?" }), repairDecision: async () => ({}), handoffSummary: async () => "" },
    inspectorEvents: { async record(_id, type) { state.events.push(type); } },
    handoffRouter: {}, workflow: null,
  });
  await p.process(70, { ids: ["2"], webhookMessages: new Map([["2", customer]]) });
  assert.deepEqual(state.sent, []);
  assert.ok(state.events.includes("agent_owned_skip"));
});

test("'ya tengo asesora' y clientes que ya pagan su plan no reciben venta", () => {
  assert.equal(mentionsOwnAdvisor("Buenas tardes ya tengo  asesora es Isela Galicia saludos y gracias"), "Isela Galicia");
  assert.equal(mentionsOwnAdvisor("Solo una cosa más me atiende la Srta Isela Galicia"), "Isela Galicia");
  assert.equal(mentionsOwnAdvisor("Prefiero seguir con Isela Galisia gracias"), "Isela Galisia");
  assert.equal(mentionsOwnAdvisor("Quiero una llamada con mi asesor"), null);
  assert.equal(existingClient("Ya estoy inscrita"), true);
  assert.equal(existingClient("Pero ya estoy pagando el plan 2"), true);
  assert.equal(existingClient("Ya tengo ese plan"), true);
  assert.equal(existingClient("Ya tengo el servicio médico"), false);
});

test("preguntas que recibían otra respuesta", () => {
  assert.equal(key("Y cuando tengo que pagar?"), "payment_order");
  assert.equal(key("El pago cuando se realiza?"), "payment_order");
  assert.equal(key("Por cuánto tiempo tengo que pagar los 1500?"), "payment_duration");
  assert.equal(key("1,100 x cuanto tiempo"), "payment_duration");
  assert.equal(key("Cada mes se actualiza o más bien se da de baja y vuelve a incorporar ?"), "same_company");
  assert.equal(key("Que permanencia se tiene con el mismo patrón??"), "same_company");
  assert.equal(key("x cuánto tiempo tendría q cotizar"), "min_weeks");
  assert.equal(key("cuántos años debería cotizar para una pensión"), "min_weeks");
  assert.equal(key("Buenas tardes disculpe es verdad que ya la modalidad 40 ya no va a seguir"), "modality_40");
  assert.equal(key("No el día 19 de octubre me dieron de baja"), null);
  assert.equal(key("Mire mi dirección en el INE no está actualizada porque yo vivía en Tabasco ahora en Saltillo"), null);
  assert.equal(key("Los 13 meses son solo para reactivar las semanas congeladas? De ahí cuanto seria en tiempo para la penciin?"), null);
  assert.equal(key("Cuando cuesta"), "price");
  assert.equal(key("Buenos días aun estoy cotizando"), "employed");
  assert.equal(key("No estoy trabajando"), null);
  const info = detectDirectRequest("Buenos días pregunta , tiene un costo el que usted me de información");
  assert.match(directAnswerText(info), /la información no tiene ningún costo/);
  assert.match(directAnswerText(detectDirectRequest("Cómo funciona y ese no aporta a afore verdad")), /Correcto: el Plan 1/);
  const partner = detectDirectRequest("Cómo puedo hacer beneficiaria a mi pareja. Vivimos en unión libre");
  assert.match(directAnswerText(partner), /aunque vivan en unión libre/);
  const employed = detectDirectRequest("Yo estoy empleado y cotizando me interesa saber lo de mi pareja");
  assert.match(directAnswerText(employed), /directamente en tu clínica del IMSS/);
});

test("pospone, rechaza o se despide: Mia no vuelve a ofrecer el plan", () => {
  const d = (t, last = "¿Quieres que te explique cómo funciona?") => deferralDecision({ ultima_respuesta_agente: last }, fixCommonTypos(t));
  assert.equal(d("Ahorita no estoy trabajando..", "¿A qué te dedicas actualmente?"), null);
  assert.equal(d("Mari estoy viendo  opciones").deferral, "later");
  assert.equal(d("Ok déjeme, checar mañana lo decido").deferral, "later");
  assert.equal(d("Todos está muy claro al próximo mes de contacto contigo para hacer el plan número 2").deferral, "later");
  assert.equal(d("Disculpe no haré trámite").deferral, "declined");
  assert.equal(d("No, me equivoqué, perdón").deferral, "mistake");
  assert.equal(d("Si gracias\nY buenas noches", "Listo. Cuando la persona responda puede escribirme.").deferral, "closing");
  assert.equal(d("Gravias igualmente", "Gracias a ti.").deferral, "closing");
  assert.equal(d("Te agradezco muchísimo", "Está bien.").deferral, "closing");
  assert.equal(d("Por el momento no", "Para confirmar aplica a tu caso: ¿ya tienes IMSS activo actualmente?"), null);
  assert.equal(d("Ok", "Entendido. Si en otro momento quieres retomarlo, aquí estoy para ayudarte. Que tengas un buen día.").reply, "");
});

test("aceptar después de '¿Quieres que iniciemos tu trámite?'", () => {
  const memory = { ultima_respuesta_agente: "Para iniciar solo necesitamos CURP, NSS e INE del titular. ¿Quieres que iniciemos tu trámite?" };
  assert.equal(confirmsStart("Si me interesa", memory), true);
  assert.equal(confirmsStart("HEGG560427MVZRRL05", memory), true);
  assert.equal(confirmsStart("A ok le mando todos mis datos por este medio", { ultima_respuesta_agente: "¿Deseas que prepare tu alta con el Plan 1?" }), true);
  // Se abre con el último plan del que se habló, no con el primero que se recomendó.
  const sale = analyzeNextSale("Sí", { ultima_respuesta_agente: "¿Quieres que iniciemos tu trámite?", nombre: "Ana López", sales_cycle: { stage: "explaining", recommended_plan: "plan_1", last_plan: "plan_2", explained_plans: ["plan_2"], pitched_plans: ["plan_1", "plan_2"] } });
  assert.equal(sale.patch.sales_cycle.selected_plan, "plan_2");
});

test("necesidad: 'los 3', 'tengo servicio médico' y recomendación sin necesidad", () => {
  assert.equal(deriveCommercialNeed("Solo quiero pensionar me tengo servicio médico").service_medical, false);
  assert.equal(deriveCommercialNeed("Solo quiero pensionar me tengo servicio médico").retirement, true);
  assert.equal(deriveCommercialNeed("infonavit ya no alcanzo, solo semanas").afore_infonavit, false);
  // Si pregunta por el Plan 1, explicárselo no es recomendar sin necesidad.
  const draft = { reply: "Plan 1 — $1,100 MXN mensuales: servicio médico y semanas cotizadas.", question_key: null };
  assert.equal(suppressRecommendationWithoutNeed(draft, {}, "El plan 1 q implica?").reply, draft.reply);
  const catalog = { reply: "Ofrecemos Plan 1 ($1,100/mes) y Plan 2 ($1,500/mes).", question_key: null };
  assert.equal(suppressRecommendationWithoutNeed(catalog, {}, "Hello! Can I get more info on this?").reply, catalog.reply);
  // Un saludo no dispara la recomendación del plan.
  assert.equal(compactPlanRecommendation({ commercial_need: { retirement: true, weeks: true }, sales_cycle: {} }, "Hola buenos días"), null);
});

test("crédito INFONAVIT, llamadas y casos para una persona", () => {
  assert.equal(hasActiveInfonavitCredit(fixCommonTypos("si ya le dije que me interesan los tres estoy pagando i fonavit no tengo seguro")), true);
  assert.equal(hasActiveInfonavitCredit("Por tener un crédito vigente de infonavit no puedo"), true);
  assert.equal(callRequest("Su  tel. Cel."), true);
  assert.equal(callRequest("Tel"), true);
  assert.equal(specializedAdviceHandoff("yo quisiera pensionarme por invalidez")?.kind, "specialized_disability_pension");
  assert.equal(specializedAdviceHandoff("Pueden ustedes ayudar a encontrar el viejo número y unificar todo mis semanas")?.kind, "specialized_nss_unification");
  assert.equal(specializedAdviceHandoff("Soy ley 73, tengo 459 semanas cotizadas, necesito asesoría y saber cuanto me cuesta."), null);
  // "Ya le dije que me interesan los tres" no es presión por un documento.
  assert.equal(analyzePatience("No entiendo la pregunta si ya le dije que me interesan los tres", { ultima_pregunta: "necesidad_principal" }).shouldPause, false);
});

test("expediente: rechazo, NSS que no tiene, 'te la envío' y prórroga de pago", () => {
  const base = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", onboarding_next: "curp", documents_missing: ["curp", "nss", "ine"] } };
  const declined = buildOnboardingDecision(base, "Muchas gracias, no necesitare el servicio, le agradezco su tiempo");
  assert.equal(declined.reply, ONBOARDING_DECLINED_TEXT);
  assert.equal(declined.onboarding_declined, true);
  assert.equal(buildOnboardingDecision({ ...base, operations: { ...base.operations, call_requested_at: new Date().toISOString() } }, "No quiero continuar con el tramite, muchas gracias").reply, ONBOARDING_DECLINED_TEXT);
  assert.equal(buildOnboardingDecision(base, "Ok te la envío").reply, "Perfecto, aquí la espero.");
  const nss = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", onboarding_next: "nss", documents_missing: ["nss", "ine"] } };
  assert.match(buildOnboardingDecision(nss, "Habíamos quedado que no lo tengo nunca lo tuve").reply, /nunca has tenido NSS/);
  assert.notEqual(buildOnboardingDecision(nss, "Si usted pudiera localizármelo por favor").reply, "Gracias. Ahora compárteme por favor el NSS del titular.");
  const paying = { sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "S1", documents_complete: true, payment_requested: true, status: "payment_requested" } };
  const ext = buildOnboardingDecision(paying, "¿Hasta el lunes puedo?");
  assert.equal(ext.reply, COBRANZA_EXTENSION_TEXT);
  assert.equal(ext.payment_extension_request, true);
  assert.ok(NSS_HELP_TEXT);
});

test("confirmado 26-oct: Modalidad 10, timbrado y otros precios", () => {
  assert.match(directAnswerText(detectDirectRequest("Sabes algo de la modalidad 10")), /no es como la Modalidad 10: es mejor, porque quedas registrado con los beneficios de un trabajador/);
  assert.match(directAnswerText(detectDirectRequest("¿Me timbran recibos de nómina?")), /no timbramos recibos de nómina/);
  const both = detectDirectRequest("Pero también busco que no cambie de patrón y que se timbre");
  assert.equal(both.answerKey, "same_company");
  for (const t of ["A.mi.me dieron costo de 1000 mensuales", "Yo estaba pagando 950 pesos cada mes", "Subió el costo de ayer a hoy?"]) {
    assert.match(directAnswerText(detectDirectRequest(t)), /gran calidad de nuestro servicio y nuestra atención al cliente/, t);
  }
});
