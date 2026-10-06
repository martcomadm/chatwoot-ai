import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { TurnLock } from "../src/core/turn-lock.js";

// Simula Chatwoot + memoria + IA para una conversación de prueba.
function harness({ ai = {}, memory = {}, turnLock = null } = {}) {
  const state = { memory: structuredClone(memory), processed: new Set(), sent: [], private: [], events: [], labels: [], transfers: [] };
  let nextId = 100;
  const build = message => {
    const conversation = { id: 900, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
    return new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: {
        async getConversation() { return structuredClone(conversation); },
        async sendMessage(_id, text, isPrivate) { (isPrivate ? state.private : state.sent).push(text); },
        async getMessages() { return { payload: [] }; },
      },
      labels: { async mergeSafe(_id, add, remove) { state.labels.push({ add, remove }); return []; } },
      memories: {
        get: () => structuredClone(state.memory),
        async set(_id, next) { state.memory = structuredClone(next); },
        async merge(_id, patch) { state.memory = { ...state.memory, ...patch }; },
        hasProcessed: (_c, id) => state.processed.has(String(id)),
        async markProcessedMany(_c, ids) { ids.forEach(id => state.processed.add(String(id))); },
      },
      agentRotation: {},
      ai: {
        extractAmbiguous: async () => ({}),
        generateDecision: async () => ({ reply: "", question_key: null }),
        repairDecision: async () => ({ reply: "", question_key: null }),
        handoffSummary: async () => "RESUMEN",
        ...ai,
      },
      inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
      handoffRouter: { async route(args) { state.transfers.push(args); return { status: "completed" }; } },
      workflow: null,
      turnLock,
    });
  };
  const message = text => ({ id: nextId++, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: text, attachments: [] });
  async function say(text) {
    const msg = message(text);
    await build(msg).process(900, { ids: [String(msg.id)], webhookMessages: new Map([[String(msg.id), msg]]) });
  }
  return { state, say, build, message };
}

test("el botón 'Información' recibe un solo saludo con presentación de Mia", async () => {
  const { state, say } = harness();
  await say("Información");
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0], /^¡Hola! Soy Mia de MARTCOM\./);
  assert.equal((state.sent[0].match(/Mia de MARTCOM/g) || []).length, 1, "no se presenta dos veces");
  assert.equal(state.memory.presentacion_realizada, true);
});

test("una respuesta válida de la IA se envía tal cual (antes siempre se reemplazaba por la pregunta de respaldo)", async () => {
  const reply = "Claro, te explico cómo funciona la afiliación: puedes contar con servicio médico del IMSS y seguir sumando semanas. ¿Qué es lo que más te interesa cuidar?";
  const { state, say } = harness({ ai: { generateDecision: async () => ({ reply, question_key: "necesidad_principal" }) }, memory: { presentacion_realizada: true, ultima_respuesta_agente: "Hola" } });
  await say("me puedes explicar un poco como funciona esto para alguien que trabaja por su cuenta");
  assert.deepEqual(state.sent, [reply]);
  const sent = state.events.find(event => event.type === "ai_reply_sent");
  assert.equal(sent.data.decision_source, "llm");
});

test("la primera respuesta de la IA lleva la presentación; las siguientes no", async () => {
  const { state, say } = harness({ ai: { generateDecision: async () => ({ reply: "Con gusto te oriento. ¿Qué te gustaría resolver primero?", question_key: null }) } });
  await say("buenas, una pregunta sobre el seguro");
  await say("es para mi");
  assert.match(state.sent[0], /^¡Hola! Soy Mia de MARTCOM\. Con gusto te oriento/);
  assert.doesNotMatch(state.sent[1] || "", /Soy Mia/);
});

test("no se repite una pregunta que el cliente ya contestó", async () => {
  const { state, say } = harness({
    ai: { generateDecision: async () => ({ reply: "¿Actualmente tienes un alta activa ante el IMSS?", question_key: "tiene_imss" }) },
    memory: { presentacion_realizada: true, ultima_respuesta_agente: "Hola", tiene_imss: false },
  });
  await say("ok");
  assert.ok(!state.sent.some(text => /alta activa ante el IMSS/.test(text)));
});

test("una respuesta vacía no se envía como mensaje en blanco", async () => {
  const { state, say } = harness({ memory: { presentacion_realizada: true, ultima_respuesta_agente: "x", ultima_pregunta: "necesidad_principal" } });
  await say("mmm");
  assert.ok(state.sent.every(text => text.trim().length > 0));
});

test("si la IA pide transferir, se hace el handoff en vez de responder", async () => {
  const { state, say } = harness({ ai: { generateDecision: async () => ({ reply: "Te comunico con un asesor.", question_key: null, handoff: true, handoff_reason: "Caso de pensión complejo" }) }, memory: { presentacion_realizada: true, ultima_respuesta_agente: "x" } });
  await say("tengo un problema con mi pensión de viudez que me negaron dos veces y no sé qué hacer");
  assert.equal(state.transfers.length, 1);
  assert.equal(state.private[0], "RESUMEN");
});

test("las etiquetas de la IA se filtran: nunca venta/cliente ni etiquetas inventadas o protegidas", async () => {
  const { state, say } = harness({ ai: { generateDecision: async () => ({ reply: "Perfecto, quedo atenta por si tienes otra duda.", question_key: null, add_labels: ["seguimiento", "venta", "inventada"], remove_labels: ["asignado", "sin_atender"] }) }, memory: { presentacion_realizada: true, ultima_respuesta_agente: "x" } });
  await say("ok gracias, lo reviso");
  assert.deepEqual(state.labels[0], { add: ["seguimiento"], remove: ["sin_atender"] });
});

test("una respuesta demasiado larga de la IA no se envía tal cual", async () => {
  const { state, say } = harness({ ai: { generateDecision: async () => ({ reply: "a".repeat(2000), question_key: null }) }, memory: { presentacion_realizada: true, ultima_respuesta_agente: "x" } });
  await say("ok");
  assert.ok(state.sent.every(text => text.length <= 850));
});

test("el mismo mensaje procesado dos veces a la vez produce una sola respuesta", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-turnlock-"));
  const lock = new TurnLock(dir);
  let calls = 0;
  const { state, build, message } = harness({ turnLock: lock, ai: { extractAmbiguous: async () => { calls += 1; return calls === 1 ? {} : { necesidad_principal: "servicio medico" }; } } });
  const msg = message("Información");
  const snapshot = { ids: [String(msg.id)], webhookMessages: new Map([[String(msg.id), msg]]) };
  await Promise.all([build(msg).process(900, snapshot), build(msg).process(900, snapshot)]);
  assert.equal(state.sent.length, 1, `se enviaron: ${JSON.stringify(state.sent)}`);
  assert.ok(state.events.some(event => event.type === "duplicate_turn_skipped"));
});

test("TurnLock: un segundo proceso no toma un mensaje ya tomado y los candados viejos se limpian", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-turnlock-"));
  const a = new TurnLock(dir);
  const b = new TurnLock(dir);
  assert.equal(a.claim(1, [10, 11]), true);
  assert.equal(b.claim(1, [11, 12]), false);
  assert.equal(fs.existsSync(a.file(1, 12)), false, "libera lo que alcanzó a tomar");
  assert.equal(b.claim(2, [10]), true, "otra conversación es independiente");
  const old = a.file(1, 10);
  const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  fs.utimesSync(old, past, past);
  assert.equal(a.prune(), 1);
  assert.equal(fs.existsSync(old), false);
});
