import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { analyzeNextSale, detectAuthorization } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { deferralDecision, detectDeferral, detectClosing } from "../src/sales/customer-deferral.js";
import { rejectsFeature } from "../src/sales/feature-rejection.js";
import { validateNameCandidate } from "../src/semantic/name-validator.js";
import { plausibleActivity, resolveAnswer } from "../src/semantic/answer-resolver.js";
import { callRequest, CALL_HANDOFF_TEXT } from "../src/core/human-request.js";
import { specializedAdviceHandoff } from "../src/core/specialized-advice-handoff.js";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { buildOnboardingDecision, DOCS_LATER_TEXT, PAYMENT_HOW_TEXT } from "../src/operations/onboarding-service.js";
import { checkReply } from "../src/ai/quality-checker.js";
import { fallbackDecision } from "../src/core/fallback.js";
import { followUpMessage } from "../src/core/follow-up.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Chats reales del 20 y 21 de octubre (export del Inspector).

function harness({ memory = {}, text, llm = "«LLM»" }) {
  const sent = []; const events = []; let mem = structuredClone(memory);
  const msgs = text.split("\n").map((t, i) => ({ id: 990 + i, message_type: 0, content: t, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 + i }));
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage(_i, t, priv) { sent.push(priv ? `[nota] ${t}` : t); }, async getMessages() { return { payload: msgs }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: llm, question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "resumen" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } }, handoffRouter: { async route() { return { routed: true }; } }, workflow: null,
  });
  return { run: () => p.process(80, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) }), sent, events, memory: () => mem };
}
const intro = { presentacion_realizada: true };

test("llamadas: 'Le puedo marcar', 'platicarlo x teléfono' → un asesor le regresa la llamada (nunca 'no hay llamadas')", async () => {
  for (const t of ["Le puedo marcar xfa", "Pero me gustaría platicarlo bien x teléfono", "me pueden llamar", "Quiero una llamada con mi asesor"]) assert.equal(callRequest(t), true, t);
  for (const t of ["no me llamen por favor", "cuánto cuesta", "marcar el plan 1"]) assert.equal(callRequest(t), false, t);
  const h = harness({ memory: { ...intro, ultima_respuesta_agente: "¿actualmente cuentas con IMSS?" }, text: "Le puedo marcar xfa", llm: "No realizamos atención por llamada" });
  await h.run();
  assert.equal(h.sent.at(-1), CALL_HANDOFF_TEXT);
  assert.ok(h.events.some(e => e.type === "handoff" && /llamada/.test(e.data.reason)));
  assert.ok(checkReply("No realizamos atención por llamada; te atiendo por este chat.", { memory: {}, maxChars: 850 }).reasons.includes("niega_llamadas"));
  assert.match(MARTCOM_KNOWLEDGE, /NUNCA digas que no hay atención por teléfono/);
});

test("'Me faltan semanas' es venta (no se canaliza) y las semanas que no aparecen tienen respuesta", () => {
  assert.equal(specializedAdviceHandoff("M faltan semanas"), null);
  assert.equal(specializedAdviceHandoff("Me faltan semanas cotizadas y no aparecen en mi historial"), null);
  assert.equal(detectDirectRequest("M faltan semanas\n???")?.answerKey, "needs_weeks");
  assert.match(directAnswerText({ answerKey: "needs_weeks" }), /seguir sumando las semanas que te faltan/);
});

test("precio: 'para que me cotice' es el precio, sin pedir el NSS; mensualidad y plazo", () => {
  const d = detectDirectRequest("Te sirve te pase número de IMSS para que me cotice");
  assert.equal(d.answerKey, "price");
  assert.match(directAnswerText(d), /^No necesito tu número de IMSS para darte el precio/);
  assert.equal(detectDirectRequest("Ya cotice más de 30 años"), null);
  const pd = detectDirectRequest("Y cuánto serían la mensualidad y en cuanto tiempo dudaría pagandolo");
  assert.equal(pd.answerKey, "payment_duration");
  assert.match(directAnswerText(pd), /\$1,100 MXN mensuales.*mes a mes/);
  assert.equal(detectDirectRequest("Tiempo de alta")?.answerKey, "process_time");
});

test("misma empresa, beneficios del Plan 2 y altas retroactivas", () => {
  assert.equal(detectDirectRequest("La empresa en donde me darán de alta seria la misma\nDe siempre\nPor q en donde estaba me la cambiaban cada mes")?.answerKey, "same_company");
  assert.equal(detectDirectRequest("No cambian de empresa a cada rato ?")?.answerKey, "same_company");
  const b = detectDirectRequest("Pregunté cuales son los beneficios del plan 2");
  assert.equal(b.plan, "plan_2");
  assert.match(directAnswerText(b), /^El Plan 2 tiene un costo de \$1,500/);
  const r = detectDirectRequest("Maneja altas con retroactivo?");
  assert.equal(r.answerKey, "retroactive");
  assert.match(directAnswerText(r), /te comunique con un asesor/);
});

test("'Pues iniciar trámite' y 'Si cuando Curp y nss ine ok' aceptan iniciar", () => {
  assert.equal(detectAuthorization("Pues iniciar trámite"), true);
  assert.equal(commitmentDecision({ sales_cycle: { recommended_plan: "plan_1" } }, "Pues iniciar trámite")?.commitment, "authorized");
  const memory = { sales_cycle: { recommended_plan: "plan_2" }, ultima_respuesta_agente: "El Plan 2 cuesta $1,500 MXN mensuales. ¿Quieres que inicie el trámite del Plan 2?" };
  assert.equal(analyzeNextSale("Si cuando Curp y nss ine ok", memory).patch.sales_cycle.authorized, true);
  assert.equal(commitmentDecision(memory, "Si pero no tengo la curp ahorita"), null);
  // La IA no da por iniciado el trámite ni manda correos.
  const q = checkReply("Perfecto, inicio tu trámite con Plan 1. El área de validación (validacion@martcom.com.mx) te contactará.", { memory: {}, maxChars: 850 });
  assert.ok(q.reasons.includes("menciona_correo") && q.reasons.includes("da_por_iniciado_sin_autorizacion"));
});

test("'No es lo que busco / Gracias' recibe respuesta; 'Gracias x su valioso tiempo' es despedida", () => {
  const memory = { nombre: "César Octavio", ultima_respuesta_agente: "¿Te quedó alguna duda sobre el Plan 2? Con gusto te la resuelvo." };
  const first = deferralDecision(memory, "No es lo que busco\nGracias");
  assert.match(first.reply, /¿Me cuentas qué es lo que buscas\?/);
  assert.match(deferralDecision({ ...memory, ultima_respuesta_agente: first.reply }, "No es lo que busco").reply, /gracias por tu tiempo/);
  assert.match(deferralDecision(memory, "Gracias no interesa").reply, /gracias por tu tiempo/);
  assert.equal(detectClosing("Gracias x su valioso tiempo", { lastReply: "¿Tienes alguna duda sobre el Plan 2 o quieres que iniciemos tu trámite?" }), true);
});

test("'Lo único q no quiero es lo del Infonavit' (con 'Si xfa' antes) descarta INFONAVIT", () => {
  assert.equal(rejectsFeature("Si xfa\nLo único q no quiero es lo del Infonavit"), "infonavit");
  assert.equal(rejectsFeature("Si xfa"), null);
});

test("pospone: 'Mañana… necesito checar mi número de IMSS', 'Voy a buscar los papeles'", () => {
  assert.equal(detectDeferral("Mañana ok necesito checar mi número de IMSS"), "later");
  assert.equal(detectDeferral("Voy a buscar los papeles"), "later");
  assert.equal(detectDeferral("mañana empiezo a trabajar, eso cuenta?"), null);
});

test("nombres y actividades que en realidad eran frases", () => {
  for (const t of ["Solo Para Servicios Médicos", "Ustedes Financian Las Mensualidades Al Imms", "Tiempo de alta"]) assert.equal(validateNameCandidate(t).ok, false, t);
  for (const t of ["Juan Benítez Luna", "Rosalva garcia molina"]) assert.equal(validateNameCandidate(t).ok, true, t);
  assert.equal(plausibleActivity("39 Ya casi 40 en un mes"), false);
  assert.equal(plausibleActivity("Ustedes financian las mensualidades al imms"), false);
  assert.equal(plausibleActivity("Promotor de ventas"), true);
  assert.equal(resolveAnswer("39 Ya casi 40 en un mes", { ultima_pregunta: "actividad" }).patch.actividad, undefined);
});

test("'¿estás dado de alta?' no se pregunta más de 2 veces y 'No hay trabajo' cuenta como no", () => {
  assert.equal(resolveAnswer("No hay trabajo no nada 😞😞", { ultima_pregunta: "tiene_imss" }).patch.tiene_imss, false);
  const memory = { asked_counts: { tiene_imss: 2 }, ultima_pregunta: "tiene_imss" };
  assert.ok(checkReply("¿Sigues cotizando en el IMSS actualmente o ya no estás cotizando?", { memory, maxChars: 850 }).reasons.includes("pregunta_repetida_muchas_veces:tiene_imss"));
  assert.doesNotMatch(fallbackDecision(memory, { question_key: "tiene_imss" }, "Ok").reply, /IMSS\?/);
});

test("expediente: 'En dos horas te lo envío' tiene respuesta; '¿y para los pagos?' explica cuándo se paga; sin aviso doble del pago", () => {
  const pending = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", onboarding_next: "curp", documents_missing: ["curp"] }, ultima_respuesta_agente: "Para continuar con tu expediente, compárteme por favor la CURP del titular." };
  assert.equal(buildOnboardingDecision(pending, "En dos horas te lo envío ando fuera").reply, DOCS_LATER_TEXT);
  assert.notEqual(buildOnboardingDecision({ ...pending, ultima_respuesta_agente: DOCS_LATER_TEXT }, "al rato te lo mando").reply, DOCS_LATER_TEXT);
  const done = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", documents_complete: true, status: "waiting_validation" }, onboarding_complete_notified: true };
  assert.equal(buildOnboardingDecision(done, "Y para realizar los pagos?").reply, PAYMENT_HOW_TEXT);
  const paid = { ...done, operations: { ...done.operations, status: "payment_received", payment_received: true, payment_received_at: new Date().toISOString() } };
  assert.equal(buildOnboardingDecision(paid, "Ya quedo").reply, "");
});

test("seguimientos: sin plan mencionado, tras la apertura de pensión no se habla del 'Plan 1'", () => {
  assert.match(followUpMessage({ commercial_need: { retirement: true }, ultima_respuesta_agente: "Para revisar tu caso, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?" }, 0), /dejaste de cotizar/);
  assert.match(followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 0), /Plan 1/);
});

test("buffer: un mensaje devuelto a la cola (respuesta reemplazada) conserva sus datos del webhook", async () => {
  const { MessageBuffer } = await import("../src/core/message-buffer.js");
  const seen = [];
  let buffer;
  buffer = new MessageBuffer(5, async (id, snap) => {
    seen.push([...snap.webhookMessages.keys()].sort());
    if (seen.length === 1) { buffer.enqueue(id, { id: 2, content: "Gracias" }, "webhook"); buffer.requeue(id, ["1"]); }
  });
  buffer.enqueue(9, { id: 1, content: "No es lo que busco" }, "webhook");
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(seen, [["1"], ["1", "2"]]);
});
