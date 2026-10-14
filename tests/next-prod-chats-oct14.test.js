import test from "node:test";
import assert from "node:assert/strict";
import { extractFast } from "../src/memory/fast-extractor.js";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { deriveCommercialNeed, needGuardDecision } from "../src/sales/need-before-recommendation.js";
import { compactPlanRecommendation, coverageAndRequirementsDecision } from "../src/sales/progressive-disclosure.js";
import { detectClosing, detectDeferral } from "../src/sales/customer-deferral.js";
import { analyzePatience } from "../src/semantic/conversational-patience.js";
import { checkReply } from "../src/ai/quality-checker.js";
import { contextualNextStep } from "../src/core/fallback.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Revisión de ~40 chats reales del 12 al 14 de octubre.

test("nombres: frases ya no se toman como nombre; nombres reales sí", () => {
  const asked = { ultima_pregunta: "nombre" };
  for (const text of ["Deje trabajar", "Que modalidad atienden", "CLARO QUE SI", "Si gracias", "Como es", "ok"]) {
    assert.equal(extractFast(text, asked).nombre ?? null, null, text);
  }
  assert.equal(extractFast("Nombre:Rosa Martha molina gallegos", asked).nombre, "Rosa Martha Molina Gallegos");
  assert.equal(extractFast("Soy Elisa cuento con 58 años no hijos menores", asked).nombre, "Elisa");
  assert.equal(extractFast("Como es\nEdgar fuentes", asked).nombre, "Edgar Fuentes");
  assert.equal(extractFast("Liliana", asked).nombre, "Liliana");
  assert.equal(extractFast("socorro del Carmen león cortez", asked).primer_nombre, "Socorro");
});

test("actividad: hogar, oficios y respuestas cortas a '¿a qué te dedicas?'", () => {
  const asked = { ultima_pregunta: "actividad" };
  assert.equal(extractFast("Labores del hogar", asked).actividad, "hogar");
  assert.equal(extractFast("Al hogar", {}).actividad, "hogar");
  assert.equal(extractFast("No tiene trabajo solo aquí en casa", asked).actividad, "hogar");
  assert.equal(extractFast("Soy obrero", asked).actividad, "obrero");
  assert.equal(extractFast("Carpintero", asked).actividad, "Carpintero");
  assert.equal(extractFast("Quiero el servicio medico", asked).actividad ?? null, null);
});

test("preguntas reales reciben respuesta directa", () => {
  const cases = {
    "Que diferencia hay": "services",
    "Me puedes explicar ambos": "services",
    "Tu dime qué cuesta lo que m ofreces": "price",
    "Tengo que pagar?": "payment_frequency",
    "en el anuncio decía que sería gratuito": "not_free",
    "que documentación necesito y a dónde o con quién puedo hacer el trámite": "requirements",
    "Qué necesita que le envíe": "requirements",
    "Que modalidad atienden": "modality",
    "Y si es legal ?": "legitimacy",
    "Y cuál es la empresa": "operational_model",
    "Con cuántos patrones dan de alta ?": "operational_model",
    "En donde está está enpresa": "location",
    "Tiene ubicación?": "location",
    "Es que estoy en busca de un seguro que por decir casi de un accidente me cubra servicio y si se puede cobrar incapacidades oh no?": "disability",
    "Y saber si me agarias mi incapacidad por maternidad": "disability",
    "Ok quisiera saber si me voy a poder jubilar con alguna jubilación???": "pension_general",
    "Cuántos años tendría que pagar para poder jubilarme": "pension_general",
    "Aque edad puedo empezar a hacer trámites para pensión": "pension_general",
  };
  for (const [text, type] of Object.entries(cases)) assert.equal(detectDirectRequest(text)?.type, type, text);
  assert.doesNotMatch(directAnswerText({ answerKey: "location" }), /Xochimilco/);
  assert.match(directAnswerText({ answerKey: "pension_general" }), /1 de julio de 1997/);
});

test("'No Infonavit no Afore y semanas ok' no recomienda el Plan 2", () => {
  assert.equal(deriveCommercialNeed("No Infonavit no Afore y semanas ok", { afore_infonavit: true }).afore_infonavit, false);
  const memory = { commercial_need: { afore_infonavit: true, weeks: true }, sales_cycle: { recommended_plan: "plan_1", stage: "plan_recommended" } };
  const reply = compactPlanRecommendation(memory, "No Infonavit no Afore y semanas ok")?.reply || "";
  assert.doesNotMatch(reply, /Plan 2/);
});

test("la pregunta de necesidad no se repite encima de una pregunta del cliente", () => {
  const memory = { nombre: "Felipe De Jesús", edad: 57, actividad: "valet" };
  assert.ok(needGuardDecision(memory, "Trabajo de valet"));
  assert.equal(needGuardDecision(memory, "Que diferencia hay"), null);
  assert.equal(needGuardDecision({ ...memory, ultima_respuesta_agente: "Felipe, para orientarte mejor, ¿qué es lo más importante para ti con la afiliación: tener servicio médico, seguir cotizando semanas o también aportar a AFORE e INFONAVIT?" }, "ok"), null);
  assert.match(needGuardDecision({ ...memory, nombre: "Deje Trabajar", primer_nombre: "Deje" }, "Comerciante").reply, /^para orientarte/);
});

test("tras ofrecer atención médica o requisitos, un 'sí' recibe ambos y la invitación a iniciar", () => {
  const memory = { ultima_respuesta_agente: "Claro. El Plan 1 incluye … Si quieres, puedo explicarte qué atención médica puedes recibir o cuáles son los requisitos para iniciar." };
  for (const text of ["Si por favor", "Ok", "si mepuede dar informes por favor"]) {
    assert.match(coverageAndRequirementsDecision(memory, text)?.reply || "", /CURP, NSS e INE.*¿Quieres que iniciemos tu trámite\?/s, text);
  }
  assert.equal(coverageAndRequirementsDecision(memory, "no gracias"), null);
});

test("despedidas y posposiciones con frases reales", () => {
  assert.equal(detectClosing("Si gracias", { lastReply: "Si antes de compartir datos quieres validar información de la empresa, con gusto podemos ayudarte a hacerlo." }), false);
  assert.equal(detectClosing("No ninguna gracias"), true);
  assert.equal(detectDeferral("Te puedo mandar mensaje mas tarde .\nMi esposito no se encuentra en casa"), "later");
  assert.equal(detectDeferral("Hola buenas tardes me interesa pero estoy en espera de resolver si me traslado a CDMX o me quedo en puebla"), "later");
  assert.equal(detectDeferral("Gracias me comunico con usted maz adelante"), "later");
  assert.equal(analyzePatience("me interesa pero estoy en espera de resolver si me traslado", {}).shouldPause, false);
});

test("revisión de calidad: sin cotizaciones, direcciones inventadas, otro nombre ni plazos de pago antes de autorizar", () => {
  const reasons = text => checkReply(text, { memory: { sales_cycle: { authorized: false } } }).reasons;
  assert.ok(reasons("¿Deseas que prepare una cotización?").includes("cotizacion_inventada"));
  assert.ok(reasons("Estamos situados en Xochimilco, Ciudad de México.").includes("ubicacion_inventada"));
  assert.ok(reasons("¡Hola! Soy Mia de MARTCOM. Soy AXEL de MARTCOM.").includes("identidad_incorrecta"));
  assert.ok(reasons("El pago debe hacerse antes de las 6:00 p.m. para evitar que el proceso se dé de baja.").includes("politica_pago_prematura"));
  assert.doesNotMatch(MARTCOM_KNOWLEDGE, /Eres AXEL/);
});

test("el respaldo ya no es '¿Me compartes un poco más sobre tu situación?'", () => {
  assert.match(contextualNextStep({ sales_cycle: { recommended_plan: "plan_1" } }), /Plan 1 o quieres que iniciemos tu trámite/);
  assert.match(contextualNextStep({}), /qué buscas principalmente/);
  assert.equal(contextualNextStep({ sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?" }), "¿Hay algo más en lo que te pueda ayudar?");
});

function processorWith({ memory = {}, messages, ai = {}, recent = [], requeue = null, turnLock = null }) {
  const state = { sent: [], events: [], memory: structuredClone(memory) };
  const conversation = { id: 70, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); }, async getMessages() { return { payload: recent }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_id, next) { state.memory = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "", ...ai },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    handoffRouter: {}, workflow: null, requeue, turnLock,
  });
  const last = messages.at(-1);
  return { state, run: () => processor.process(70, { ids: messages.filter(m => m.message_type === 0).map(m => String(m.id)), webhookMessages: new Map(messages.map(m => [String(m.id), m])) }) };
}
const msg = (id, content, extra = {}) => ({ id, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], ...extra });

test("si el cliente escribe mientras Mia prepara la respuesta, no manda dos: atiende todo junto", async () => {
  const requeued = [];
  const released = [];
  const { state, run } = processorWith({
    messages: [msg(500, "Genaro Gayosso")],
    memory: { ultima_pregunta: "nombre", presentacion_realizada: true, ultima_respuesta_agente: "¿Cuál es tu nombre completo?" },
    ai: { generateDecision: async () => ({ reply: "Genaro, ¿cuál es tu edad?", question_key: "edad" }) },
    recent: [msg(500, "Genaro Gayosso"), msg(501, "Cuales son los planes que tienen?")],
    requeue: (id, ids) => requeued.push([id, ids]),
    turnLock: { claim: () => true, release: (_c, ids) => released.push(...ids) },
  });
  await run();
  assert.equal(state.sent.length, 0, "no envía la respuesta vieja");
  assert.deepEqual(requeued, [[70, ["500"]]]);
  assert.deepEqual(released, ["500"]);
  assert.ok(state.events.some(e => e.type === "reply_superseded"));
});

test("una nota de voz sin texto recibe '¿me lo puedes escribir?'", async () => {
  const { state, run } = processorWith({ messages: [msg(600, "", { attachments: [{ file_type: "audio" }] })], memory: { presentacion_realizada: true, ultima_respuesta_agente: "¿Cuál es tu necesidad?" } });
  await run();
  assert.match(state.sent[0], /no puedo escuchar notas de voz/);
});

test("la IA que repite una pregunta ya contestada conserva su respuesta sin la pregunta", async () => {
  const { state, run } = processorWith({
    messages: [msg(700, "¿Y puedo meter a mi mamá?")],
    memory: { nombre: "Laura Perez", edad: 61, actividad: "costurera", tiene_imss: true, presentacion_realizada: true, ultima_respuesta_agente: "x", sales_cycle: { recommended_plan: "plan_1", stage: "explaining", pitched_plans: ["plan_1"], explained_plans: ["plan_1"] } },
    ai: { generateDecision: async () => ({ reply: "Sí, puedes registrar a tus padres como beneficiarios conforme a las reglas del IMSS. ¿A qué te dedicas actualmente?", question_key: "actividad" }) },
  });
  await run();
  assert.equal(state.sent[0], "Sí, puedes registrar a tus padres como beneficiarios conforme a las reglas del IMSS.");
});

test("la presentación 'Soy Mia de MARTCOM.' siempre lleva saludo", async () => {
  const { state, run } = processorWith({
    messages: [msg(800, "Hola buenos dias")],
    ai: { generateDecision: async () => ({ reply: "Soy Mia de MARTCOM. ¿Qué necesitas hoy: servicio médico, recuperar semanas cotizadas, AFORE/INFONAVIT u otra cosa?", question_key: "necesidad_principal" }) },
  });
  await run();
  assert.match(state.sent[0], /^¡Hola! Soy Mia de MARTCOM\. ¿Qué necesitas hoy/);
});

import { MessageBuffer } from "../src/core/message-buffer.js";
test("MessageBuffer.requeue: lo pendiente y lo nuevo se atienden en el siguiente turno", async () => {
  const calls = [];
  let buffer;
  buffer = new MessageBuffer(5, async (id, snapshot) => {
    calls.push(snapshot.ids.slice().sort());
    if (calls.length === 1) { buffer.enqueue(id, { id: 2 }, "message_created", {}); buffer.requeue(id, ["1"]); }
  });
  buffer.enqueue(9, { id: 1 }, "message_created", {});
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(calls, [["1"], ["1", "2"]]);
});
