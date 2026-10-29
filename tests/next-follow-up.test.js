import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FollowUpStore, FollowUpService, followUpMessage, parseFollowUpMinutes } from "../src/core/follow-up.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

const MIN = 60 * 1000;
const T0 = new Date("2026-10-12T16:00:00Z"); // lunes 10:00 a.m. en CDMX
const at = minutes => new Date(T0.getTime() + minutes * MIN);
const secs = d => Math.floor(d.getTime() / 1000);

function setup({ messages = null, labels = [], assignee = 53, status = "open", memory = {}, isOpen = () => true, paused = false } = {}) {
  const state = { sent: [], labels: [], events: [], memory: structuredClone(memory) };
  const conversation = {
    id: 5, inbox_id: 7, status, labels, meta: { assignee: assignee ? { id: assignee } : null },
    messages: messages || [
      { id: 1, message_type: 0, content: "Hola", created_at: secs(at(-1)), private: false, sender_type: "Contact" },
      { id: 2, message_type: 1, content: "¡Hola! Soy Mia de MARTCOM…", created_at: secs(T0), private: false, sender_type: "User", sender: { id: 1, type: "user" } },
    ],
  };
  const store = new FollowUpStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-fu-")), "f.json"));
  const service = new FollowUpService({
    store,
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); conversation.messages.push({ id: 100 + state.sent.length, message_type: 1, content: text, created_at: secs(new Date()), private: false, sender_type: "User", sender: { id: 1, type: "user" } }); } },
    labels: { async mergeSafe(_id, add) { state.labels.push(...add); return add; } },
    memories: { get: () => structuredClone(state.memory), async set(_id, m) { state.memory = m; } },
    config: { chatwoot: { inboxId: 7, agentId: 53 } },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    isOpen, isMiaPaused: () => paused,
  });
  service.afterReply(5, { customerAt: at(-1), now: T0, reply: "¡Hola! Soy Mia de MARTCOM…" });
  return { service, state, store, conversation };
}

test("FOLLOWUP_MINUTES: valores por defecto y validación", () => {
  assert.deepEqual(parseFollowUpMinutes(""), [20, 180, 1200]);
  assert.deepEqual(parseFollowUpMinutes("15,60"), [15, 60]);
  assert.throws(() => parseFollowUpMinutes("60,30"));
  assert.throws(() => parseFollowUpMinutes("a,b"));
});

test("seguimientos a los 20 min, 3 h y 20 h; al cerrar la ventana pone 'no_contesta'", async () => {
  const { service, state, store } = setup();
  await service.tick(at(19));
  assert.equal(state.sent.length, 0, "antes de 20 min no escribe");
  await service.tick(at(20));
  assert.equal(state.sent.length, 1);
  await service.tick(at(60));
  assert.equal(state.sent.length, 1, "no repite antes de tiempo");
  await service.tick(at(180));
  assert.equal(state.sent.length, 2);
  await service.tick(at(1200));
  assert.equal(state.sent.length, 3);
  await service.tick(at(1300));
  assert.equal(state.sent.length, 3, "no hay cuarto mensaje");
  await service.tick(at(24 * 60));
  assert.deepEqual(state.labels, ["no_contesta"]);
  assert.equal(store.list().length, 0);
  assert.ok(state.events.some(e => e.type === "followup_no_response"));
});

test("si el cliente contesta, se cancela la serie", async () => {
  const { service, state } = setup();
  await service.tick(at(20));
  service.customerWrote(5);
  await service.tick(at(180));
  assert.equal(state.sent.length, 1);
});

test("si el último mensaje es del cliente (aún sin procesar), no se manda seguimiento", async () => {
  const { service, state, conversation } = setup();
  conversation.messages.push({ id: 9, message_type: 0, content: "ya volví", created_at: secs(at(10)), private: false, sender_type: "Contact" });
  await service.tick(at(20));
  assert.equal(state.sent.length, 0);
  assert.ok(state.events.some(e => e.type === "followup_cancelled" && e.data.reason === "customer_wrote"));
});

test("si una persona del equipo escribió, o el chat se reasignó, cerró o pausó, no hay seguimiento", async () => {
  const human = setup();
  human.conversation.messages.push({ id: 10, message_type: 1, content: "Te atiendo yo", created_at: secs(at(5)), private: false, sender_type: "User", sender: { id: 77, type: "user" } });
  await human.service.tick(at(20));
  assert.equal(human.state.sent.length, 0);
  for (const options of [{ assignee: 99 }, { status: "resolved" }, { labels: ["pausar_mia"] }, { labels: ["venta"] }]) {
    const { service, state } = setup(options);
    await service.tick(at(20));
    assert.equal(state.sent.length, 0, JSON.stringify(options));
  }
});

test("con la pausa general de Mia no se manda nada", async () => {
  const { service, state } = setup({ paused: true });
  await service.tick(at(20));
  assert.equal(state.sent.length, 0);
});

test("fuera de horario espera a abrir, siempre dentro de la ventana de 24 h", async () => {
  let open = false;
  const { service, state } = setup({ isOpen: () => open });
  await service.tick(at(20));
  assert.equal(state.sent.length, 0);
  open = true;
  await service.tick(at(300));
  assert.equal(state.sent.length, 1, "al abrir manda el primero");
  await service.tick(at(310));
  assert.equal(state.sent.length, 1, "deja al menos 1 h entre seguimientos");
  await service.tick(at(360));
  assert.equal(state.sent.length, 2);
});

test("los mensajes dependen de dónde se quedó la conversación", () => {
  assert.match(followUpMessage({}, 0), /¿Sigues por aquí\?/);
  assert.match(followUpMessage({ sales_cycle: { recommended_plan: "plan_2" } }, 0), /duda sobre el Plan 2/);
  assert.match(followUpMessage({ sales_cycle: { recommended_plan: "plan_1" } }, 1), /iniciemos tu trámite con el Plan 1/);
  assert.match(followUpMessage({ sales_cycle: { authorized: true }, operations: { onboarding_next: "curp" } }, 0), /tu CURP/);
  assert.equal(followUpMessage({ sales_cycle: { authorized: true }, operations: { documents_complete: true } }, 0), null);
});

test("el seguimiento queda como última respuesta de Mia (un 'sí' a '¿iniciamos?' cuenta)", async () => {
  const { service, state } = setup({ memory: { sales_cycle: { recommended_plan: "plan_2" } } });
  await service.tick(at(20));
  await service.tick(at(180));
  assert.match(state.memory.ultima_respuesta_agente, /¿Te gustaría que iniciemos tu trámite con el Plan 2\?/);
});

test("el processor programa seguimientos al contestar y los cancela cuando el cliente escribe", async () => {
  const calls = [];
  const followUps = { afterReply: (id, opts) => calls.push(["after", id, opts.reply]), customerWrote: id => calls.push(["wrote", id]) };
  const make = content => {
    const message = { id: 300, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [] };
    const conversation = { id: 12, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
    const processor = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage() {}, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {},
      ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
      inspectorEvents: { async record() {} },
      handoffRouter: {}, workflow: null, followUps,
    });
    return () => processor.process(12, { ids: ["300"], webhookMessages: new Map([["300", message]]) });
  };
  await make("Hola, quiero información")();
  assert.deepEqual(calls.map(c => c[0]), ["wrote", "after"]);
  calls.length = 0;
  await make("No me interesa, gracias")();
  assert.ok(!calls.some(c => c[0] === "after"), "tras un rechazo no se programan seguimientos");
});
