// Export del 10 al 11-nov (222 conversaciones).
import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { detectDirectRequest, orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { FACT_LOCKED_TYPES } from "../src/core/deterministic-decision-policy.js";
import { featureRejectionDecision } from "../src/sales/feature-rejection.js";
import { detectDeferral } from "../src/sales/customer-deferral.js";
import { detectScheduledStart } from "../src/sales/scheduled-start.js";
import { parseCaseData } from "../src/sales/case-diagnosis.js";
import { explicitHumanRequest } from "../src/core/human-request.js";
import { buildOnboardingDecision, CALL_ACK_TEXT, WHO_CALLS_TEXT, DOCS_ALREADY_TEXT, looksLikeCallSlot } from "../src/operations/onboarding-service.js";
import { followUpMessage, startDateOnHold } from "../src/core/follow-up.js";
import { AD_OPENINGS, AD_OPENING_PENSION_B, AD_OPENING_NO_IMSS_B } from "../src/sales/ad-openings.js";
import { SLOTS } from "../src/knowledge/experiments.js";
import { menuChoiceText } from "../src/sales/need-menu.js";

const PLAN = { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], pitched_plans: ["plan_1"] }, ultima_respuesta_agente: "Claro. El Plan 1 incluye… ¿Quieres que iniciemos tu trámite?" };
const PENSION = { id: "ta1", topic: "Pensión", phrases: ["pension", "pensionarme"], answer: "Para tu pensión podemos recuperar y seguir cotizando semanas con salario diario registrado de $480 MXN." };

async function run(text, memory0, { teamAnswers = null } = {}) {
  let memory = structuredClone(memory0);
  const message = { id: 903, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: text, attachments: [] };
  const sent = []; const events = [];
  const norm = v => String(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 53, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage(_id, t, priv) { if (!priv) sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, n) { memory = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "LLM", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, d) { events.push([type, d]); } }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
    teamAnswers: teamAnswers && { match: t => teamAnswers.find(a => a.phrases.some(ph => ` ${norm(t).replace(/[^a-z0-9 ]+/g, " ")} `.includes(` ${ph} `))) ? { ...teamAnswers[0], matched_phrase: teamAnswers[0].phrases.find(ph => norm(t).includes(ph)) } : null, promptBlock: () => "" },
  });
  await p.process(53, { ids: ["903"], webhookMessages: new Map([["903", message]]) });
  return { text: sent.join(" "), memory, events };
}

test("respuesta del equipo con palabra clave: cede ante la pregunta concreta y no se repite", async () => {
  // Caso real (conv 11585): "¿Cuánto queda la pensión?" recibió dos veces los planes.
  const a = await run("Cuánto queda la pensión?", PLAN, { teamAnswers: [PENSION] });
  assert.match(a.text, /El monto exacto de tu pensión lo calcula el IMSS/);
  assert.ok(a.events.some(([t, d]) => t === "team_answer_skipped" && d.reason === "hay_respuesta_mas_especifica"));
  // Sin nada más específico y si es pregunta, la respuesta del equipo sí sale… una sola vez por chat.
  // 13-nov: con frase corta ya no contesta afirmaciones ("lo que quiero es una asesoría para pensión…").
  const plain = await run("lo que quiero es una asesoría para pensión trabaje 31 años en una empresa", PLAN, { teamAnswers: [PENSION] });
  assert.doesNotMatch(plain.text, /^Para tu pensión podemos recuperar/);
  const b = await run("¿Qué pasa con mi pensión si me afilio?", PLAN, { teamAnswers: [PENSION] });
  assert.match(b.text, /^Para tu pensión podemos recuperar/);
  assert.deepEqual(b.memory.team_answers_sent, ["ta1"]);
  const c = await run("¿y lo de la pensión entonces?", { ...PLAN, team_answers_sent: ["ta1"] }, { teamAnswers: [PENSION] });
  assert.doesNotMatch(c.text, /^Para tu pensión podemos recuperar/);
  // "No me interesa para afore ni infonavit" (conv 10361) recibió una despedida: es quedarse con el Plan 1.
  const d = await run("No me interesa para afore ni infonavit", PLAN, { teamAnswers: [PENSION] });
  assert.match(d.text, /Plan 1 de \$1,100 MXN mensuales es suficiente/);
});

test("cliente que ya está con MARTCOM y reclama pasa a una persona (conv 11362)", async () => {
  assert.equal(explicitHumanRequest("ya pagué más de un año con ustedes y recuperé mi derecho a pension pero no me dieron de baja"), true);
  assert.equal(explicitHumanRequest("resulta que no pueden dar de baja en el imss y por lo tanto no me he podido pensionar"), true);
  assert.equal(explicitHumanRequest("Que seguridad tengo que no me dan de baja después de pagar?"), false, "esa duda la contesta Mia");
  const r = await run("No sé con quién hablo que no entiende ya pagué más de un año con ustedes", PLAN, { teamAnswers: [PENSION] });
  assert.match(r.text, /le pido a un asesor de nuestro equipo que continúe contigo/);
  assert.doesNotMatch(r.text, /contexto/, "el cliente preguntó '¿qué contexto?' (conv 11585)");
});

test("'comuníquense conmigo' ofrece la llamada; 'hoy le mando mensaje' es posponer", async () => {
  const r = await run("Por favor comuníquense con migo", PLAN);
  assert.match(r.text, /un asesor te llama/);
  assert.equal(detectDeferral("Si hoy le mando mensaje"), "later");
});

test("dudas frecuentes del 10-nov tienen respuesta directa", () => {
  const key = t => detectDirectRequest(t)?.answerKey;
  assert.equal(key("Dónde se. Ubican\nYo soy de puebla"), "location");
  assert.equal(key("¿Tienen oficina en Monterrey?"), "location");
  assert.equal(key("Me podría dar una cita para ir a su oficina y decirle a detalle mis dudas"), "office_visit");
  assert.equal(key("Me gustaría visitarlos en su empresa"), "office_visit");
  assert.equal(key("Cuánto queda la pensión?"), "pension_amount");
  assert.equal(key("Pero lo que la pregunta es, ¿ustedes me facturarían?"), "invoice");
  assert.equal(key("Entendí perfectamente el pago mensual Cuánto tiempo dura este pago mensual Un año dos tres o cuánto?"), "payment_duration");
  assert.equal(key("El plan 2 en que es diferente"), "services");
  assert.ok(["company_name", "registration_how"].includes(key("Si como es el registro.\n- Tendré un patrón. O como se genera el registro.\n- Dónde se hacen los pagos.")));
  for (const k of ["pension_amount", "office_visit", "company_workers", "invoice", "registration_how"]) assert.ok(FACT_LOCKED_TYPES.has(k), k);
  assert.match(orchestrateConversation("Yo marco , a qué número?", PLAN).directAnswer, /un asesor te llame/);
});

test("'sería hasta el jueves' es aceptar con fecha y no se le piden documentos antes", () => {
  assert.ok(detectScheduledStart("Si pero sería asta el jueves para asegurar el dinero primero"));
  const at = new Date("2026-11-10T13:50:00-06:00"); // martes
  const memory = { sales_cycle: { authorized: true, scheduled_start: { when: "el jueves", text: "Si pero sería asta el jueves para asegurar el dinero primero", at: at.toISOString() } }, operations: { sale_id: "S", documents_complete: false, documents_missing: ["curp"], onboarding_next: "curp" } };
  assert.equal(startDateOnHold(memory, new Date("2026-11-11T10:00:00-06:00")), true);
  assert.equal(startDateOnHold(memory, new Date("2026-11-12T10:00:00-06:00")), false, "el jueves ya se le recuerda");
  const quincena = { sales_cycle: { authorized: true, scheduled_start: { when: "la quincena", text: "en la quincena", at: at.toISOString() } } };
  assert.equal(startDateOnHold(quincena, new Date(at.getTime() + 24 * 3600 * 1000)), true);
  assert.equal(startDateOnHold(quincena, new Date(at.getTime() + 50 * 3600 * 1000)), false);
  assert.equal(followUpMessage({ ...memory, sales_cycle: { ...memory.sales_cycle, scheduled_start: { ...memory.sales_cycle.scheduled_start, at: new Date().toISOString(), when: "la quincena", text: "" } } }, 0), null);
});

test("'a partir del 2011 inicié al 2020': empezó en 2011 (conv 11603)", () => {
  assert.equal(parseCaseData("Apartir del 2011 inicie a el 2020", { askedStartYear: true }).startYear, 2011);
});

test("cliente con llamada pedida: solo un horario se agradece; '¿quién me llama?' y 'ya me pidieron los documentos' se contestan (conv 11344)", () => {
  const memory = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", documents_complete: false, documents_missing: ["curp"], onboarding_next: "curp", call_requested_at: new Date().toISOString() } };
  assert.equal(buildOnboardingDecision(memory, "A las 5 de la tarde").reply, CALL_ACK_TEXT);
  assert.equal(buildOnboardingDecision(memory, "Ya me.pidieron la documentacion").reply, DOCS_ALREADY_TEXT);
  assert.equal(buildOnboardingDecision(memory, "Entonces quien es la señorita q me está llamando").reply, WHO_CALLS_TEXT);
  assert.equal(looksLikeCallSlot("Después de las 4 de la tarde porfa"), true);
  assert.equal(looksLikeCallSlot("Lizeth Morales"), false);
});

test("aperturas de los anuncios que menos venden entran a prueba A/B", () => {
  assert.ok(AD_OPENING_PENSION_B.length < AD_OPENINGS.pension.length);
  for (const phrase of SLOTS["ad_opening:pension"].required) assert.ok(AD_OPENING_PENSION_B.includes(phrase));
  assert.equal(menuChoiceText(`¡Hola! Soy Mia de MARTCOM. ${AD_OPENING_NO_IMSS_B}`, "2"), "Quiero seguir sumando semanas para mi pensión");
});
