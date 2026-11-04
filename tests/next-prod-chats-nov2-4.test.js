import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { fixCommonTypos } from "../src/semantic/typos.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { acceptsAdvisorOffer } from "../src/core/human-request.js";
import { deferralDecision, detectDeferral } from "../src/sales/customer-deferral.js";
import { parseCaseData, caseDiagnosisDecision } from "../src/sales/case-diagnosis.js";
import { explicitHumanRequest } from "../src/core/human-request.js";
import { asksPersonalData, checkReply } from "../src/ai/quality-checker.js";

// Chats reales del 2 al 4-nov: de 42 chats de los anuncios "revisar mi caso" y "seguir sumando para pensión" no se
// cerró ninguna venta. El cliente contaba su caso y recibía un texto genérico, luego "¿te explico?", luego la
// explicación; la IA seguía pidiendo nombre/edad; un "Dejé de cotizar el 30 de marzo de 96" se tomó como "pospone".
const key = t => detectDirectRequest(fixCommonTypos(t))?.answerKey || null;

function conversation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-funnel-"));
  const workflow = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  const state = { memory: {}, sent: [], ai: [] };
  let n = 0;
  const say = async content => {
    n++;
    const m = { id: n, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: Math.floor(Date.now() / 1000) };
    const before = state.sent.length;
    const p = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 }, sender: { id: 1 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) state.sent.push(t); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(state.memory), async set(_i, v) { state.memory = v; }, async merge(_i, v) { state.memory = { ...state.memory, ...v }; }, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {},
      ai: { extractAmbiguous: async () => ({}), generateDecision: async (_c, _l, _m, planner) => { state.ai.push(planner); return { reply: "¿Me compartes tu nombre completo?", question_key: planner?.question_key || null }; }, repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
      inspectorEvents: { async record() {} }, handoffRouter: {}, workflow,
    });
    await p.process(5, { ids: [String(n)], webhookMessages: new Map([[String(n), m]]) });
    return state.sent.slice(before).join("\n");
  };
  return { state, say };
}

const CASE_Q = "¡Hola! Soy Mia de MARTCOM. Con gusto revisamos tu caso. Para saber qué opciones tienes, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?";
const now = new Date("2026-11-04T12:00:00-06:00");

test("revisar mi caso: con su año de inicio recibe su caso (Ley 73), el plan y la pregunta de iniciar; un sí abre el trámite", async () => {
  const c = conversation();
  assert.match(await c.say("Información y revisar mi caso con mi NSS"), /en qué año empezaste a cotizar\?/);
  const diag = await c.say("Sii Buenos días más se 10 años que deje de cotizar empecé a cotizar en el como 85");
  assert.match(diag, /^Gracias por contarme\. Como empezaste a cotizar en 1985, antes del 1 de julio de 1997, tu caso es Ley 73/);
  assert.match(diag, /13 meses/);
  assert.match(diag, /Plan 1.*\$1,100 MXN mensuales/s);
  assert.match(diag, /el primer pago se hace hasta que tu alta ya está vigente\. ¿Quieres que iniciemos tu trámite\?$/);
  assert.ok(diag.length <= 850);
  assert.equal(c.state.memory.pension_data?.cotizo_antes_1997, true);
  assert.match(await c.say("Si por favor"), /CURP/);
  assert.equal(c.state.memory.sales_cycle.authorized, true);
});

test("anuncio de pensión: fechas de cuándo cotizó no son 'lo pospongo'", async () => {
  assert.equal(detectDeferral("Comenzé a cotizar el 1 de septiembre del 88\nDejé de cotizar el 30 de marzo de 96"), null);
  assert.equal(detectDeferral("Empiezo el 1 de diciembre"), "later", "una fecha futura sí pospone");
  const c = conversation();
  await c.say("Dejé de cotizar, quiero seguir sumando para pensionarme");
  assert.match(await c.say("Comenzé a cotizar el 1 de septiembre del 88\nDejé de cotizar el 30 de marzo de 96"), /Como empezaste a cotizar en 1988.*Ley 73.*¿Quieres que iniciemos tu trámite\?$/s);
});

test("solo saluda tras la pregunta del caso: se repite breve una vez (no '¿tienes IMSS?' ni '¿tu nombre?')", async () => {
  const c = conversation();
  await c.say("Información y revisar mi caso con mi NSS");
  const again = await c.say("Buenos días, una disculpa es que tenía cargando el celular");
  assert.match(again, /¿recuerdas más o menos en qué año comenzaste a cotizar y hace cuánto dejaste de hacerlo\?/);
  assert.match(await c.say("Empecé a cotizar desde hace 36 años"), /tu caso es Ley 73/);
  const m = { ultima_respuesta_agente: "¡Con gusto! Para revisar tu caso, ¿recuerdas más o menos en qué año comenzaste a cotizar y hace cuánto dejaste de hacerlo? Con eso te digo qué opción te conviene." };
  assert.equal(caseDiagnosisDecision(m, "Hola"), null, "no se repite dos veces");
});

test("lectura de los datos del caso (textos reales)", () => {
  const p = t => parseCaseData(t, { now, askedStartYear: true });
  assert.equal(p("Hola  Empecé en 1988 Deje de cotizar 2010").ley, 73);
  assert.equal(p("Cotice muy poco , como año inmedio\nCómo deSde el 2005").ley, 97);
  assert.equal(p("24 años rine que deje de cotizar  y empese a cotizar en 1973").startYear, 1973);
  assert.equal(p("Buen día me dieron de alta en el 90 pero deje de trabajar mucho tiempo").startYear, 1990);
  assert.equal(p("Hace 25 años aproximadamente dejé de cotizar, coticé 84 semanas, soy ley 73").ley, 73);
  assert.equal(p("1988").startYear, 1988);
  assert.equal(p("Tengo 50 años, 2 años sin trabajo.").startYear, null, "la edad no es el año");
  assert.equal(p("Aún estoy cotizando").stillContributing, true);
  const m = { ultima_respuesta_agente: CASE_Q };
  assert.equal(caseDiagnosisDecision(m, "Aún estoy cotizando"), null, "sigue cotizando: lo atiende su propia respuesta");
  assert.equal(caseDiagnosisDecision(m, "¿Cuánto cuesta?"), null, "una pregunta la contesta la respuesta oficial");
  assert.equal(caseDiagnosisDecision(m, "Empecé en 1986 y también cotice al ISSSTE"), null, "ISSSTE lo ve un asesor");
  assert.match(caseDiagnosisDecision(m, "Empecé en 2003 y quiero también afore", { now }).reply, /Ley 97.*Plan 2.*\$1,500/s);
});

test("la IA ya no pide nombre, edad ni actividad antes de que el cliente acepte", () => {
  assert.equal(asksPersonalData("¿Cuál es tu nombre completo, por favor?"), true);
  assert.equal(asksPersonalData("Gracias. ¿Me indicas tu edad, por favor?"), true);
  assert.equal(asksPersonalData("¿A qué te dedicas actualmente?"), true);
  assert.equal(asksPersonalData("El Plan 1 cuesta $1,100 MXN. ¿Quieres que iniciemos tu trámite?"), false);
  assert.ok(checkReply("¿Cuál es tu nombre completo, por favor?", { memory: {} }).reasons.includes("pide_datos_antes_de_aceptar"));
  assert.ok(!checkReply("¿Cuál es tu nombre completo, por favor?", { memory: { sales_cycle: { authorized: true } } }).reasons.includes("pide_datos_antes_de_aceptar"));
});

test("'Si. Por favor' a '¿Confirmas que iniciemos tu trámite…?' y 'comencemos en la segunda quincena' abren el trámite", () => {
  const m = { sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Confirmas que iniciemos tu trámite en la segunda quincena de noviembre con ese plan?" };
  assert.equal(commitmentDecision(m, "Si. Por favor")?.commitment, "authorized");
  assert.equal(commitmentDecision({ sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Quieres que iniciemos tu trámite?" }, "Hola, no tengo duda. Le parece que comencemos en la segunda quincena de noviembre?")?.commitment, "authorized");
  assert.equal(commitmentDecision({ sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "Si te parece bien, ¿iniciamos tu trámite con el Plan 1?" }, "Si")?.commitment, "authorized");
});

test("'¿cuánto cobran ustedes por su servicio?' y '¿el primer pago es en el IMSS?' reciben los honorarios", () => {
  assert.equal(key("Y de su servicio cuanto cobran"), "fees");
  assert.equal(key("Uno hace el. Primer pago en el. Imss"), "fees");
  assert.equal(key("Cuánto cuesta"), "price");
});

test("molestia porque contesta una computadora: pasa a una persona", () => {
  assert.equal(explicitHumanRequest("Pinche computadoras ponen"), true);
  assert.equal(explicitHumanRequest("No sé si es una computadora o qué es lo quien me está contestando"), true);
  assert.equal(explicitHumanRequest("Tengo computadora en casa"), false);
});

test("'Sip' a '¿Te gustaría que te explique cómo funciona…?' recibe la explicación (no otra oferta de explicar)", async () => {
  const c = conversation();
  await c.say("Información y revisar mi caso con mi NSS");
  assert.match(await c.say("Aún estoy cotizando"), /te explique cómo funciona/);
  const r = await c.say("Sip");
  assert.match(r, /^Claro\. El Plan 1 incluye/);
  assert.match(r, /¿Quieres que iniciemos tu trámite\?$/);
});

test("tras la recomendación corta, un 'sí' recibe la explicación completa, no el resumen", async () => {
  const c = conversation();
  await c.say("¡Hola! Quiero más información");
  await c.say("No");
  await c.say("Servicio médico");
  assert.match(await c.say("Si"), /^Claro\. El Plan 1 incluye.*\$480/s);
});

// Punto 1 (4-nov): el segundo seguimiento ofrece un menú numerado; responder "2" sigue la venta.
import { followUpMessage } from "../src/core/follow-up.js";
import { NEED_MENU_TEXT, menuChoiceText } from "../src/sales/need-menu.js";

test("segundo seguimiento sin plan: menú numerado (general y pensión); con plan sigue igual", () => {
  assert.equal(followUpMessage({ ultima_respuesta_agente: "¿actualmente cuentas con IMSS?" }, 1), NEED_MENU_TEXT);
  assert.equal(followUpMessage({ ultima_respuesta_agente: CASE_Q }, 1), NEED_MENU_TEXT);
  assert.match(followUpMessage({ ultima_respuesta_agente: CASE_Q }, 0), /en qué año empezaste a cotizar/, "el primero repite la pregunta del caso y vale para el diagnóstico");
  assert.match(followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 1), /iniciemos tu trámite con el Plan 1/);
});

test("respuestas al menú", () => {
  const t = x => menuChoiceText(NEED_MENU_TEXT, x);
  assert.match(t("2"), /semanas para mi pensión/);
  assert.match(t("La 1"), /servicio médico/);
  assert.match(t("opción 3 por favor"), /AFORE e INFONAVIT/);
  assert.match(t("3️⃣"), /AFORE e INFONAVIT/);
  assert.match(t("el uno"), /servicio médico/);
  assert.match(t("1 y 2"), /semanas/);
  assert.equal(t("Tengo 2 hijos y quiero el seguro"), null, "un número dentro de otra frase no es elegir");
  assert.equal(t("Empecé en el 85"), null);
  assert.equal(menuChoiceText("¿Quieres que iniciemos tu trámite?", "2"), null, "sin menú, un número no es una opción");
});

test("del menú a iniciar: '2' → plan → explicación → sí", async () => {
  const c = conversation();
  await c.say("¡Hola! Quiero más información");
  c.state.memory = { ...c.state.memory, ultima_respuesta_agente: NEED_MENU_TEXT };
  assert.match(await c.say("2"), /Plan 1.*\$1,100/s);
  assert.match(await c.say("Si"), /¿Quieres que iniciemos tu trámite\?$/);
  await c.say("Si");
  assert.equal(c.state.memory.sales_cycle.authorized, true);
});

// Punto 3 (4-nov): el último seguimiento ofrece una llamada de un asesor.
import { acceptsCallOffer } from "../src/core/human-request.js";

test("tercer seguimiento: ofrece que un asesor le llame (con plan, pensión y general)", () => {
  assert.match(followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 2), /^¿Prefieres que un asesor te llame unos minutos y te explique el Plan 1 con calma\? Dime sí y a qué hora/);
  assert.match(followUpMessage({ ultima_respuesta_agente: CASE_Q }, 2), /asesor te llame.*pensión/);
  assert.match(followUpMessage({}, 2), /asesor te llame.*opciones/);
  assert.match(followUpMessage({ sales_cycle: { authorized: true }, operations: {} }, 2), /ayude a completar tu expediente/, "con trámite iniciado, la llamada es para completar el expediente");
});

test("aceptar la llamada: 'sí', 'a las 5', 'mañana en la tarde'; no: 'no gracias', 'por mensaje'", () => {
  const L = followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 2);
  assert.deepEqual(acceptsCallOffer("Si", L), { time: null });
  assert.equal(acceptsCallOffer("A las 5", L).time, "A las 5");
  assert.ok(acceptsCallOffer("mañana en la tarde", L).time);
  assert.equal(acceptsCallOffer("No gracias", L), null);
  assert.equal(acceptsCallOffer("Ya no me interesa", L), null);
  assert.equal(acceptsCallOffer("Mejor por mensaje", L), null);
  assert.equal(acceptsCallOffer("Si", "¿Quieres que iniciemos tu trámite?"), null, "sin la oferta, un sí es otra cosa");
});

test("'A las 5' al último seguimiento: pasa con un asesor para llamada y se confirma al cliente", async () => {
  const c = conversation();
  await c.say("¡Hola! Quiero más información");
  c.state.memory = { ...c.state.memory, ultima_respuesta_agente: followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 2) };
  assert.match(await c.say("A las 5"), /^¡Perfecto! Le dejo tu horario a un asesor para que te marque a este número/);
  assert.ok(!c.state.memory.sales_cycle?.authorized, "no abre trámite: es una llamada");
});

test("recordatorios de documentos: cómo conseguir lo que falta y, al final, oferta de llamada", () => {
  const m = k => ({ sales_cycle: { authorized: true }, operations: { onboarding_next: k, documents_missing: [k] } });
  assert.match(followUpMessage(m("curp"), 0), /gob\.mx\/curp/);
  assert.match(followUpMessage(m("nss"), 0), /lo localizamos con tu CURP\. Si ya lo tienes, envíamelo por aquí/);
  assert.match(followUpMessage(m("ine"), 1), /solo falta tu INE.*frente y otra de reverso/s);
  const last = followUpMessage(m("ine"), 2);
  assert.match(last, /asesor te llame y te ayude a completar tu expediente/);
  assert.ok(acceptsCallOffer("Sí, a las 6", last)?.time, "también vale con el trámite iniciado");
});
