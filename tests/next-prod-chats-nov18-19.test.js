import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SelfSenders } from "../src/core/self-senders.js";
import { personAnsweredLast } from "../src/core/agent-ownership.js";
import { acceptsCallOffer } from "../src/core/human-request.js";
import { detectScheduledStart } from "../src/sales/scheduled-start.js";
import { deferralDecision, gotJob } from "../src/sales/customer-deferral.js";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { needGuardDecision } from "../src/sales/need-before-recommendation.js";
import { buildOnboardingDecision } from "../src/operations/onboarding-service.js";
import { extractFast } from "../src/memory/fast-extractor.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

test("cuenta compartida: un mensaje de la cuenta de Mia que Mia no envió es de una persona", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-"));
  const file = path.join(dir, "self-senders.json");
  const self = new SelfSenders(file, [53]);
  const old = { id: 1, sender_id: 53, created_at: 1000 };
  assert.equal(self.isOwn(old), true); // sin registro todavía: todo lo de la cuenta es de Mia
  self.learn({ id: 10, sender_id: 53, created_at: Date.now() / 1000 });
  assert.equal(self.tracking, true);
  assert.equal(self.isOwn({ id: 10, sender_id: 53, created_at: Date.now() / 1000 }), true);
  assert.equal(self.isOwn({ id: 11, sender_id: 53, created_at: Date.now() / 1000 + 120 }), false, "lo escribió una persona con la cuenta de Mia");
  assert.equal(self.isOwn(old), true, "lo anterior al registro se sigue tomando como de Mia");
  const again = new SelfSenders(file, [53]);
  assert.equal(again.tracking, true);
  assert.equal(again.isOwn({ id: 10, sender_id: 53, created_at: Date.now() / 1000 }), true, "el registro sobrevive a un reinicio");
});

test("#11962: el cliente le contesta a una persona del equipo (ya aceptó) → Mia no responde", async () => {
  const now = Math.floor(Date.now() / 1000);
  const messages = [
    { id: 1, message_type: 1, content: "Gracias, recibí tu archivo…", created_at: now - 3600, sender_type: "User", sender: { id: 53, type: "user" } },
    { id: 2, message_type: 1, content: "Disculpe, me pide que le registre una clínica, me puede decir cuál le queda cerca, por favor", created_at: now - 600, sender_type: "User", sender: { id: 77, type: "user", name: "Carlos" } },
    { id: 3, message_type: 0, content: "La 76 de ecatepec  por la vía morelos", created_at: now - 60, sender_type: "Contact", sender: { type: "contact" } },
  ];
  assert.ok(personAnsweredLast({ messages }, ["3"], { miaAgentId: 53 }));
  assert.equal(personAnsweredLast({ messages }, ["3"], { miaAgentId: 53, sinceIso: new Date((now - 300) * 1000).toISOString() }), null, "después de regresar el chat a Mia ya no cuenta");
  assert.equal(personAnsweredLast({ messages: messages.filter(m => m.id !== 2) }, ["3"], { miaAgentId: 53 }), null);
  let memory = { presentacion_realizada: true, sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "s1", onboarding_next: "nss", documents_missing: ["nss"], nss_resolution: "lookup_by_curp" }, ultima_respuesta_agente: "Perfecto, ya recibimos tu documentación." };
  const sent = []; const events = [];
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 90, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: structuredClone(messages) }; }, async sendMessage(_i, t, priv) { if (!priv) sent.push(t); }, async getMessages() { return { payload: messages }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_i, n) { memory = n; }, async merge(_i, patch) { memory = { ...memory, ...patch }; }, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "«LLM»" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } },
  });
  await p.process(90, { ids: ["3"], webhookMessages: new Map([["3", messages[2]]]) });
  assert.deepEqual(sent, []);
  assert.ok(events.some(e => e.type === "person_answering_skip"));
});

test("#11866 / #11920: llamada — 'yo ya estoy cotizando' no la acepta; la hora a 'un asesor puede regresarte la llamada' sí", () => {
  const offer = "¿Prefieres que un asesor te llame unos minutos y te explique el Plan 1 con calma? Dime sí y a qué hora te queda bien, y te marcamos a este número.";
  assert.equal(acceptsCallOffer("Muchas gracias yo ya estoy cotizando ok", offer), null);
  assert.ok(acceptsCallOffer("Sí, ya", offer));
  assert.ok(acceptsCallOffer("Como a las 7:00pm", "Este número de WhatsApp no recibe llamadas, pero un asesor puede regresarte la llamada. ¿En qué horario te queda mejor?"));
  assert.equal(gotJob("Muchas gracias yo ya estoy cotizando ok"), true);
  assert.match(deferralDecision({ ultima_respuesta_agente: offer, sales_cycle: { recommended_plan: "plan_1" } }, "Muchas gracias yo ya estoy cotizando ok").reply, /Mientras sigas cotizando ya cuentas con IMSS/);
});

test("#11944: 'Sí pero a fin de mes' / 'el día 1ro' aceptan con fecha", () => {
  assert.equal(detectScheduledStart("Si pero a fin de mes va.")?.when, "a fin de mes");
  assert.equal(detectScheduledStart("Si pero el dia 1ro.va")?.when, "el día 1ro");
  assert.equal(detectScheduledStart("Si pero el lunes le confirmo"), null);
});

test("#11977: 'no quiero iniciar ningún trámite' se despide; el plan es del que se habló", () => {
  const mem = { ultima_respuesta_agente: "¿Tienes alguna duda sobre el Plan 2 o quieres que iniciemos tu trámite?", sales_cycle: { recommended_plan: "plan_1", last_plan: "plan_2" } };
  assert.match(deferralDecision(mem, "No tengo duda, por el momento no quiero iniciar ningún trámite  Gracias").reply, /^Entendido, gracias por tu tiempo/);
  assert.match(deferralDecision(mem, "mañana te mando mis papeles").reply, /con el Plan 2/);
  // Mia libre: "👍" después de despedirse no recibe otra oferta.
  assert.equal(deferralDecision({ ultima_respuesta_agente: "De acuerdo, gracias por tu tiempo. Si más adelante necesitas afiliarte al IMSS, puedes escribirnos por este medio." }, "👍").reply, "");
});

test("#11950 / #11967 / #11949: revisión del caso y el NSS", () => {
  const CASE = "¡Hola! Soy Mia de MARTCOM. Con gusto revisamos tu caso. Para saber qué opciones tienes, ¿hace cuánto dejaste de cotizar y, más o menos, en qué año empezaste a cotizar?";
  assert.equal(orchestrateConversation("No e cotizado como en 4 años pero en mí juventud si cotise más no se cuántas semanas tengo cotizadas asta la actualidad", { ultima_respuesta_agente: CASE }).directAnswer, null);
  assert.doesNotMatch(orchestrateConversation("quiero ver cual puede ser mi situacion para una mejor pension", {}).directAnswer, /NSS/);
  assert.equal(orchestrateConversation("Bueno dejeme boy a solicitar mi numero de afiliacion x fabor", {}).directRequest?.answerKey, "nss_lookup");
});

test("#11953 / #11970: resumen de planes una sola vez; 'Aorita no estoi cotisando' = sin IMSS", () => {
  const menu = "Hola de nuevo 😊 Para darte la información correcta, ¿qué te interesa más? Responde con el número: 1️⃣ …";
  assert.equal(needGuardDecision({ tiene_imss: false, ultima_respuesta_agente: menu }, "gracias orita no estoy trabajando")?.plans_overview, true);
  assert.equal(needGuardDecision({ tiene_imss: false, plans_overview_sent: true, ultima_respuesta_agente: menu }, "gracias orita no estoy trabajando"), null);
  assert.equal(extractFast("Aorita.no.estoi Cotisando").tiene_imss, false);
});

test("#11960: 'Okey permíteme' a la solicitud de la CURP no repite la solicitud", () => {
  const mem = { sales_cycle: { authorized: true }, operations: { sale_id: "s", onboarding_next: "curp", documents_missing: ["curp", "nss"] }, ultima_respuesta_agente: "Para continuar con tu expediente, compárteme por favor la CURP del titular." };
  assert.equal(buildOnboardingDecision(mem, "Okey  permite me").reply, "Perfecto, aquí la espero.");
});
