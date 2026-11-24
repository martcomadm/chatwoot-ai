import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { existingClient } from "../src/core/agent-ownership.js";
import { callRequest } from "../src/core/human-request.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { detectDeferral } from "../src/sales/customer-deferral.js";
import { buildOnboardingDecision } from "../src/operations/onboarding-service.js";

// Chatwoot entrega en GET /conversations/:id solo el último mensaje; los anteriores vienen en /messages.
function processorWith(messages, memory) {
  const sent = []; const events = [];
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: {
      async getConversation() { return { id: 90, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [structuredClone(messages.at(-1))] }; },
      async getMessages() { return { payload: structuredClone(messages) }; },
      async sendMessage(_i, t, priv) { if (!priv) sent.push(t); },
    },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_i, n) { memory = n; }, async merge(_i, patch) { memory = { ...memory, ...patch }; }, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "«LLM»" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } },
  });
  return { p, sent, events };
}

test("#11895: el cliente le contesta a una persona aunque Chatwoot solo mande el último mensaje", async () => {
  const now = Math.floor(Date.now() / 1000);
  const messages = [
    { id: 1, message_type: 1, content: "Gracias, recibí tu archivo.", created_at: now - 9000, sender_type: "User", sender: { id: 53, type: "user" } },
    { id: 2, message_type: 1, content: "Hola, buen día. Solo paso a dar seguimiento a tu proceso de afiliación al IMSS. ¿Te gustaría que avancemos con tu registro hoy?", created_at: now - 7000, sender_type: "User", sender: { id: 77, type: "user", name: "Erika" } },
    { id: 3, message_type: 0, content: "No sería lunes 30 para poder pagar está bien", created_at: now - 60, sender_type: "Contact", sender: { type: "contact" } },
  ];
  const memory = { presentacion_realizada: true, sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "s1", onboarding_next: null, documents_missing: [] }, ultima_respuesta_agente: "Gracias, recibí tu archivo." };
  const { p, sent, events } = processorWith(messages, memory);
  await p.process(90, { ids: ["3"], webhookMessages: new Map([["3", messages[2]]]) });
  assert.deepEqual(sent, [], "no manda 'Listo, ya tengo los datos…'");
  assert.ok(events.some(e => e.type === "person_answering_skip"));
});

test("#12018: '¿A dónde voy a depositar?' con el alta ya vigente no dice 'el pago es hasta que tu alta esté vigente'", () => {
  const mem = { sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "s1", status: "validity_confirmed", validity_confirmed: true, documents_complete: true, documents_missing: [], plan: "plan_1" }, ultima_respuesta_agente: "Tu afiliación ya aparece vigente. Te comparto tu documento de vigencia." };
  const reply = buildOnboardingDecision(mem, "Adonde voy a depositar?")?.reply || "";
  assert.doesNotMatch(reply, /hasta que tu alta esté vigente/);
  assert.match(reply, /ya (?:está|aparece) vigente/);
});

test("clientes que ya están con nosotros (#12218)", () => {
  for (const t of ["Ya estoy contigo en el imss", "Ya estoy con ustedes afiliado", "Klar_Comprobante_21112026_172205.pdf"]) assert.equal(existingClient(t), true, t);
  for (const t of ["Quiero estar con ustedes", "¿Qué necesito para estar con ustedes?"]) assert.equal(existingClient(t), false, t);
});

test("un número de teléfono solo es para que le llamen (#12181)", () => {
  for (const t of ["5512345678", "55 1234 5678", "mi número es 5512345678"]) assert.equal(callRequest(t), true, t);
  assert.equal(callRequest("12345678901"), false, "11 dígitos es NSS, no teléfono");
});

test("saldo de AFORE y posponer (export 23 al 24-nov)", () => {
  for (const t of ["Yo quería saber si cto tengo en afore", "cuánto tengo en mi afore"]) assert.equal(detectDirectRequest(t)?.answerKey, "afore_balance", t);
  for (const t of ["Ok el día de mañana me pongo en contacto con uds gracias", "Buenos días el.martes en la noche regreso.ahorita ando en citas médicas y estudios"]) assert.equal(detectDeferral(t), "later", t);
});

test("con el número ya dado no se le pregunta a qué número; '¿cuánto tengo en mi AFORE?' no es querer el Plan 2", async () => {
  const { callHandoffText } = await import("../src/core/human-request.js");
  const { deriveCommercialNeed } = await import("../src/sales/need-before-recommendation.js");
  assert.doesNotMatch(callHandoffText("5512345678"), /a qué número/);
  assert.match(callHandoffText("¿me pueden llamar?"), /a qué número/i);
  assert.equal(deriveCommercialNeed("Yo quería saber si cto tengo en afore", {}).afore_infonavit, false);
  assert.equal(deriveCommercialNeed("quiero aportar a mi afore", {}).afore_infonavit, true);
});

test("las respuestas directas nuevas sí se envían (están en la lista de respuestas fijas)", async () => {
  const { FACT_LOCKED_TYPES } = await import("../src/core/deterministic-decision-policy.js");
  for (const k of ["about_us", "weeks_per_year", "afore_balance"]) assert.ok(FACT_LOCKED_TYPES.has(k), k);
});
