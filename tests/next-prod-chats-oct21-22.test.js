import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor, fitLength } from "../src/core/conversation-processor.js";
import { analyzeNextSale, detectPlanPreference } from "../src/sales/next-sales-engine.js";
import { deferralDecision, detectDeferral } from "../src/sales/customer-deferral.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { priceObjectionDecision } from "../src/sales/progressive-disclosure.js";
import { deriveCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { adOpeningDecision } from "../src/sales/ad-openings.js";
import { validateNameCandidate } from "../src/semantic/name-validator.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { acceptsAdvisorOffer } from "../src/core/human-request.js";
import { specializedAdviceHandoff } from "../src/core/specialized-advice-handoff.js";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { buildOnboardingDecision, NSS_HELP_TEXT } from "../src/operations/onboarding-service.js";
import { checkReply } from "../src/ai/quality-checker.js";

// Chats reales del 21 y 22 de octubre (export del Inspector).
const q = (t, memory = {}) => checkReply(t, { memory, maxChars: 850 }).reasons;

test("revisión de calidad: ya no tira respuestas buenas", () => {
  // "¿Quieres que inicie el trámite?" es una pregunta, no dar por iniciado.
  assert.deepEqual(q("Te recomiendo el Plan 1. ¿Quieres que inicie el trámite?").filter(r => /iniciado/.test(r)), []);
  assert.deepEqual(q("Si quieres, inicio tu trámite hoy mismo.").filter(r => /iniciado/.test(r)), []);
  assert.ok(q("Perfecto, inicio tu trámite con Plan 1.").includes("da_por_iniciado_sin_autorizacion"));
  // "Semanas de cotización" es normal; "te preparo una cotización", no.
  assert.ok(!q("Con 728 semanas de cotización puedes seguir sumando.").includes("cotizacion_inventada"));
  assert.ok(q("Te preparo una cotización personalizada.").includes("cotizacion_inventada"));
  // La pregunta repetida solo cuenta si la anterior también fue esa.
  assert.ok(!q("¿A qué te dedicas actualmente?", { asked_counts: { nombre: 2 }, ultima_pregunta: "edad" }).some(r => /repetida/.test(r)));
  // Respuesta un poco larga: se recorta en la última oración en vez de cambiarla por una genérica.
  const long = "Oración uno completa. ".repeat(50);
  assert.ok(fitLength(long, 850).length <= 850 && fitLength(long, 850).endsWith("."));
});

test("faltas de ortografía: rekisitos, funsiona, k nesesito, solopara servisiomedico", () => {
  assert.equal(fixCommonTypos("cuales son los rekisitos"), "cuales son los requisitos");
  assert.equal(fixCommonTypos("Solopara servisiomedico"), "solo para servicio medico");
  assert.equal(detectDirectRequest(fixCommonTypos("k nesesitamos"))?.answerKey, "requirements");
  assert.equal(detectDirectRequest(fixCommonTypos("Cuanto sale lamensualida"))?.answerKey, "price");
});

test("preguntas que no se contestaban", () => {
  const key = t => detectDirectRequest(t)?.answerKey;
  assert.equal(key("Hola me puedes explicar y que costos tienen"), "price");
  assert.equal(detectDeferral("Que costos tienen para platicarlo con mi pareja"), null);
  assert.equal(detectDirectRequest("Ok y por curiosidad el plan 2 cuál sería")?.plan, "plan_2");
  assert.equal(detectDirectRequest("Y lo del Infonavit donde queda porfa")?.plan, "plan_2");
  assert.equal(key("Sería el plan 1, pero dónde  pagaria"), "payment_method");
  assert.equal(detectPlanPreference("Sería el plan 1, pero dónde pagaria"), "plan_1");
  assert.equal(key("Explíqueme como es por que me va a cotizar con muy poco"), "salary_pension");
  const order = detectDirectRequest("Dando la documentación a partir de cuándo se tiene que hacer la aportación y es fija o variable");
  assert.equal(order.answerKey, "payment_order");
  assert.match(directAnswerText(order), /La mensualidad es fija/);
  assert.equal(key("Sigo laborando, pero no tengo seguro social tengo 58 años"), "working_no_imss");
  assert.equal(key("El costo de la activación"), "fees");
  assert.equal(key("Me refiero a sus honorarios"), "fees");
  const nss = detectDirectRequest("Pero si mo tengo ssn");
  assert.equal(nss.answerKey, "missing_docs");
  assert.match(directAnswerText(nss), /con tu CURP lo podemos localizar/);
  assert.match(directAnswerText(detectDirectRequest("X lo pronto no tengo mi IFE. Apenas la tramite")), /INE la envías cuando la tengas/);
  const weeks = detectDirectRequest("Si claro\nMe faltan 5 semanas para completar las que necesito para la pension");
  assert.equal(weeks.answerKey, "few_weeks_left");
  assert.match(directAnswerText(weeks), /5 semanas se completan en aproximadamente 2 meses/);
});

test("'es más caro, ¿cuál es la diferencia?' no es objeción de precio; 'me dieron el dinero de la afore' no pide Plan 2", () => {
  assert.equal(priceObjectionDecision({ sales_cycle: { recommended_plan: "plan_1" } }, "Si me puedes hacer favor de compartir lo del plan 2 porque es más caro cuál es la diferencia"), null);
  assert.ok(priceObjectionDecision({ sales_cycle: { recommended_plan: "plan_1" } }, "está muy caro, ¿no hay descuento?"));
  assert.equal(deriveCommercialNeed("Ya no tengo, me dieron el dinero y el aforé", {}).afore_infonavit, false);
  assert.equal(detectPlanPreference("Ya no tengo, me dieron el dinero y el aforé"), null);
  assert.equal(deriveCommercialNeed("Aportar si es posible", {}).afore_infonavit, true);
  assert.equal(specializedAdviceHandoff("desconozco totalmente ese tema de pensionarse, dígame si hay que pagar honorarios"), null);
});

test("quiere iniciar pero después: se le dice qué tener listo (no 'gracias por tu tiempo')", () => {
  const memory = { nombre: "Victor Gabriel", sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "Listo. Para iniciar necesito que me envíes por este chat la CURP, el NSS y una foto de la INE. ¿Los tienes a la mano?" };
  const d = deferralDecision(memory, "No de momento ya que ando en la calle pero como en dos horas te lo mando ya que lo cheque en casa donde tengo mis papeles");
  assert.equal(d.deferral, "start_later");
  assert.match(d.reply, /envíamelos por aquí y arrancamos tu trámite con el Plan 1/);
  assert.equal(deferralDecision(memory, "Podemos iniciar el trámite el lunes\nVoy hoy a buscar mis papeles").deferral, "start_later");
  assert.equal(deferralDecision(memory, "No de momento, gracias").deferral, "declined");
  assert.equal(confirmsStart("Esta bien adelante", { ultima_respuesta_agente: "¿Quieres que revisemos tu caso para ver si puedes reactivar y proceder con el trámite?" }), true);
  const mem2 = { sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?" };
  assert.equal(analyzeNextSale("Si solo que estoy trabajando puedo enviarle papeles mañana", mem2).patch.sales_cycle.authorized, true);
});

test("'Ok, voy a buscar la hoja rosa y te envío foto' no acepta pasar con un asesor", () => {
  const last = "¿Quieres que te comunique con un asesor para revisar tu caso?";
  assert.equal(acceptsAdvisorOffer("Ok, voy a buscar la joya rosa y te envío foto, haber que podemos hacer.", last), false);
  assert.equal(acceptsAdvisorOffer("Si", last), true);
  assert.equal(acceptsAdvisorOffer("Si por favor, pásame con el asesor", last), true);
});

test("nombres que eran frases; 'Deje de cotizar' a secas abre como el anuncio de pensión", () => {
  for (const t of ["Haber Aclárame La Ecuación A Seguir", "Solo Trabaje Un Año", "Chofer De Taxi En Colima"]) assert.equal(validateNameCandidate(t).ok, false, t);
  for (const t of ["J.francisco olivera Gutiérrez", "Luis Del Campo Pinto", "Ma. Crisanta Lopez"]) assert.equal(validateNameCandidate(t).ok, true, t);
  assert.equal(adOpeningDecision({}, "Deje de cotizar")?.ad_opening, "pension");
});

test("expediente: '¿Qué es NSS?' se explica; 'Paquete 2' se confirma o se avisa al equipo", () => {
  const nss = { sales_cycle: { authorized: true }, operations: { sale_id: "S", onboarding_next: "nss", documents_missing: ["nss"] } };
  assert.equal(buildOnboardingDecision(nss, "Que es NSS").reply, NSS_HELP_TEXT);
  assert.equal(buildOnboardingDecision(nss, "a cual se refiere").reply, NSS_HELP_TEXT);
  const done = { sales_cycle: { authorized: true }, operations: { sale_id: "S", documents_complete: true, status: "waiting_validation", plan: "plan_1" }, onboarding_complete_notified: true };
  const change = buildOnboardingDecision(done, "Paquete 2");
  assert.equal(change.plan_change_request, "plan_2");
  assert.match(change.reply, /Ya le aviso al equipo/);
  assert.match(buildOnboardingDecision(done, "plan 1").reply, /^Sí, tu trámite va con el Plan 1/);
});

function harness({ memory = {}, text, llm = "«LLM»", labels = [], recent = null }) {
  const sent = []; const events = []; const added = []; let mem = structuredClone(memory);
  const msgs = text.split("\n").map((t, i) => ({ id: 990 + i, message_type: 0, content: t, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 + i }));
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: recent || msgs }; } },
    labels: { async mergeSafe(_i, add) { added.push(...(add || [])); return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: llm, question_key: null, add_labels: labels }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } }, handoffRouter: {}, workflow: null,
  });
  return { run: () => p.process(80, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) }), sent, events, added, memory: () => mem };
}

test("la IA ya no pone etiquetas de cierre que callan a Mia", async () => {
  const h = harness({ memory: { presentacion_realizada: true, ultima_respuesta_agente: "x" }, text: "No quiero ningún plan, yo lo único que quiero es una pensión", llm: "Entiendo, para la pensión hay que sumar semanas.", labels: ["no_quiere_el_servicio", "seguimiento"] });
  await h.run();
  assert.ok(!h.added.includes("no_quiere_el_servicio"));
});

test("otro turno de Mia ya contestó esos mensajes: no se manda una segunda respuesta", async () => {
  const reply = "Ya te contesté esto.";
  const recent = [
    { id: 990, message_type: 0, content: "Semanas", private: false, sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 },
    { id: 991, message_type: 1, content: reply, private: false, created_at: 1005 },
  ];
  const h = harness({ memory: { presentacion_realizada: true, ultima_respuesta_agente: reply }, text: "Semanas", llm: "Otra respuesta distinta", recent });
  await h.run();
  assert.deepEqual(h.sent, []);
  assert.ok(h.events.some(e => e.type === "already_answered_skip"));
});
