import test from "node:test";
import assert from "node:assert/strict";
import { mentionsOwnAdvisor } from "../src/core/agent-ownership.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { detectScheduledStart, scheduledStartIntro, SCHEDULE_OFFER_MARK } from "../src/sales/scheduled-start.js";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { orchestrateConversation, detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

// Export del 3 al 5-nov: 82 chats nuevos y una sola venta. Clientes que querían iniciar con fecha o que
// decían "pero sí me interesa" terminaban en despedida, y un "que siga sin interrupción" se pasó a un
// "asesor" llamado Sin Interrupcion.

const ASKED = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?" };

test("'que siga sin interrupción' no es un asesor (conv 11269)", () => {
  assert.equal(mentionsOwnAdvisor("En este momento tengo inscripción al seguro pero me termina el dia 30 de nov., si quiero que siga sin interrupción ,.cuando tendria que hacer el pago para que continue el 1 de dic?"), null);
  assert.equal(mentionsOwnAdvisor("quiero que siga activo mi seguro"), null);
  assert.equal(mentionsOwnAdvisor("Prefiero seguir con Isela"), "Isela");
  assert.equal(mentionsOwnAdvisor("Ya tengo asesora, es Isela Galicia"), "Isela Galicia");
});

test("'Pero sí me interesa' a '¿quieres que iniciemos?' acepta (conv 11282)", () => {
  assert.equal(analyzeNextSale("Pero si me interesa", ASKED).authorized, true);
  assert.equal(analyzeNextSale("Pero si me inyeresa", ASKED).authorized, true);
  assert.equal(analyzeNextSale("no me interesa", ASKED).authorized, false);
});

test("acepta con fecha: queda autorizado con la fecha (convs 11301 y 11208)", () => {
  const a = analyzeNextSale("La verdad a míe gustaría que se realizará ahora pero para cubrir el pago sería en unos 10 días", ASKED);
  assert.equal(a.authorized, true);
  assert.equal(a.patch.sales_cycle.scheduled_start.when, "en unos 10 días");
  const b = analyzeNextSale("Hola, no tengo duda. Le parece que comencemos en la segunda quincena de noviembre?", ASKED);
  assert.equal(b.authorized, true);
  assert.equal(b.patch.sales_cycle.scheduled_start.when, "la segunda quincena de noviembre");
  // Sin plan platicado todavía no se abre nada.
  assert.equal(analyzeNextSale("Quiero iniciar en diciembre", {}).authorized, false);
  assert.equal(detectScheduledStart("No quiero iniciar hasta enero"), null);
  assert.equal(detectScheduledStart("¿Cuánto cuesta en diciembre?"), null);
  assert.match(scheduledStartIntro({ when: "en unos 10 días" }), /programe tu alta para dentro de unos 10 días\. Hoy no pagas nada/);
  assert.match(scheduledStartIntro(detectScheduledStart("Quiero darme de alta cuando me paguen")), /para cuando te paguen/);
});

test("sin dinero: una vez se ofrece programar el alta; si contesta la fecha, acepta", () => {
  assert.equal(detectDeferral("Solo dame oportunidad de organizar mis gasto porque si me interesó mucho"), "no_money");
  assert.equal(detectDeferral("Yo le aviso xke yo no tengo ingresos economicos"), "no_money");
  assert.equal(detectDeferral("Le abiso x la tarde k tenga todos mis papeles x favor"), "later");
  const offer = deferralDecision(ASKED, "Ahorita por el momento no por que no tengo dinero gracias");
  assert.ok(offer.reply.endsWith(SCHEDULE_OFFER_MARK));
  assert.match(offer.reply, /hoy no pagas nada/);
  const offered = { ...ASKED, ultima_respuesta_agente: offer.reply };
  const yes = analyzeNextSale("el 15", offered);
  assert.equal(yes.authorized, true);
  assert.equal(yes.patch.sales_cycle.scheduled_start.when, "el 15");
  assert.equal(analyzeNextSale("No, mejor yo le aviso", offered).authorized, false);
  // Ya se ofreció: la siguiente vez se despide.
  assert.match(deferralDecision({ ...ASKED, sales_cycle: { ...ASKED.sales_cycle, schedule_offered: true } }, "no tengo dinero").reply, /Cuando tengas la posibilidad/);
});

test("respuestas que faltaban: AFORE en el Plan 1, pagar directo al IMSS, semanas", () => {
  const afore = orchestrateConversation("Debo aportar $1,100 al mes y con eso cubre el servicio médico y aporte al afore?", ASKED);
  assert.match(afore.directAnswer || "", /no incluye aportaciones a AFORE/);
  assert.equal(detectDirectRequest("Y los pagos al IMSS  lo aria yo directo al seguro")?.answerKey, "pay_to_imss");
  assert.equal(detectDirectRequest("El plan 1 también es con la continuación de semanas, verdad?")?.answerKey, "plan1_confirm");
  const ley73 = orchestrateConversation("Si soy ley 73 tengo 589 semanas", ASKED);
  assert.match(ley73.directAnswer || "", /ya cumples las 500 semanas mínimas.*13 meses/);
  const ley97 = orchestrateConversation("Ahora me reconocen 520 semanas", { ...ASKED, pension_data: { cotizo_antes_1997: false } });
  assert.match(ley97.directAnswer || "", /te faltan unas 280 para las 800/);
  const unknown = orchestrateConversation("tengo 300 semanas", ASKED);
  assert.match(unknown.directAnswer || "", /en qué año empezaste a cotizar/);
});

test("en el processor: acepta con fecha → confirma la fecha y avisa a Captura con nota privada", async () => {
  const sent = [];
  let memory = { presentacion_realizada: true, ...structuredClone(ASKED) };
  const message = { id: 700, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "La verdad me gustaría que se realizara ahora pero para cubrir el pago sería en unos 10 días", attachments: [] };
  const conversation = { id: 31, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text, priv) { sent.push({ text, priv: Boolean(priv) }); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, next) { memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Perfecto. Para continuar con tu expediente, compárteme por favor tu CURP.", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} },
    handoffRouter: {}, workflow: null,
    followUps: { afterReply() {}, customerWrote() {} },
  });
  await processor.process(31, { ids: ["700"], webhookMessages: new Map([["700", message]]) });
  assert.equal(memory.sales_cycle.authorized, true);
  assert.equal(memory.sales_cycle.scheduled_start.when, "en unos 10 días");
  const pub = sent.filter(m => !m.priv);
  assert.equal(pub.length, 1);
  assert.match(pub[0].text, /^¡Perfecto! Dejamos tu trámite apartado y le pido al equipo que programe tu alta para dentro de unos 10 días\. Hoy no pagas nada/);
  assert.doesNotMatch(pub[0].text, /vigente\. Perfecto/);
  const note = sent.find(m => m.priv);
  assert.match(note?.text || "", /^MÍA → CAPTURA[\s\S]*Programen el alta para dentro de unos 10 días/);
});
