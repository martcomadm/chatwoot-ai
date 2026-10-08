import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { MessageBuffer } from "../src/core/message-buffer.js";
import { ConversationProcessor, PAUSE_LABEL } from "../src/core/conversation-processor.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("un error en una conversación no detiene el servicio ni las demás conversaciones", async () => {
  const errors = [];
  const done = [];
  const buffer = new MessageBuffer(5, async id => { if (id === 1) throw new Error("OpenAI 429"); done.push(id); }, { onError: (id, error) => errors.push([id, error.message]) });
  const original = console.error;
  console.error = () => {};
  try {
    buffer.enqueue(1, { id: 10 }, "message_created", {});
    buffer.enqueue(2, { id: 20 }, "message_created", {});
    await wait(60);
  } finally { console.error = original; }
  assert.deepEqual(errors, [[1, "OpenAI 429"]]);
  assert.deepEqual(done, [2]);
  buffer.enqueue(1, { id: 11 }, "message_created", {});
  await wait(40);
  assert.equal(buffer.states.get(1).processing, false, "la conversación con error no queda trabada");
});

function processorWith({ ai = {}, labels = [], paused = false } = {}) {
  const state = { memory: {}, sent: [], events: [], processed: new Set() };
  const message = { id: 77, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Tengo una duda, trabajo por mi cuenta vendiendo comida y no sé si esto me sirve", attachments: [] };
  const conversation = { id: 5, inbox_id: 7, meta: { assignee: { id: 53 } }, labels, messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(state.memory), async set(_id, next) { state.memory = next; }, async merge(_id, patch) { state.memory = { ...state.memory, ...patch }; }, hasProcessed: (_c, id) => state.processed.has(String(id)), async markProcessedMany(_c, ids) { ids.forEach(id => state.processed.add(String(id))); } },
    agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "", ...ai },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    handoffRouter: {},
    workflow: null,
    isMiaPaused: () => paused,
  });
  return { state, run: () => processor.process(5, { ids: ["77"], webhookMessages: new Map([["77", message]]) }) };
}

test("si OpenAI falla, Mia responde con la pregunta de respaldo en vez de quedarse callada", async () => {
  const fail = async () => { throw new Error("Request timed out."); };
  const original = console.error;
  console.error = () => {};
  let h;
  try {
    h = processorWith({ ai: { extractAmbiguous: fail, generateDecision: fail } });
    await h.run();
  } finally { console.error = original; }
  assert.equal(h.state.sent.length, 1);
  assert.ok(h.state.sent[0].length > 10);
  assert.deepEqual(h.state.events.filter(event => event.type === "ai_error").map(event => event.data.step), ["extract", "decision"]);
  assert.equal(h.state.events.find(event => event.type === "ai_reply_sent").data.decision_source, "fallback_ai_error");
});

test("con Mia pausada globalmente no se responde y los mensajes quedan marcados", async () => {
  const h = processorWith({ paused: true, ai: { generateDecision: async () => ({ reply: "Hola", question_key: null }) } });
  await h.run();
  assert.deepEqual(h.state.sent, []);
  assert.equal(h.state.events[0].type, "mia_paused_skip");
  assert.equal(h.state.events[0].data.reason, "global");
  assert.ok(h.state.processed.has("77"), "al reanudar no contestará este mensaje viejo");
});

test("la etiqueta pausar_mia pausa solo esa conversación", async () => {
  const h = processorWith({ labels: [PAUSE_LABEL], ai: { generateDecision: async () => ({ reply: "Hola", question_key: null }) } });
  await h.run();
  assert.deepEqual(h.state.sent, []);
  assert.equal(h.state.events[0].data.reason, "label");
});

test("Supervisión pausa y reanuda a Mia desde Operations; Captura no puede", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-pause-"));
  const saleStore = new SaleStore(path.join(dir, "sales.json"));
  const users = new UserStore(path.join(dir, "u.json"));
  const settings = new OpsSettingsStore(path.join(dir, "s.json"), path.join(dir, "i.bin"));
  const audit = new OpsAuditStore(path.join(dir, "a.json"));
  users.create({ username: "sup.uno", name: "Sup Uno", areas: ["supervision"], password: "clave-segura-123" });
  users.create({ username: "cap.uno", name: "Cap Uno", areas: ["captura"], password: "clave-segura-123" });
  const app = express();
  app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: {} }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories: {}, inspectorEvents: {}, buffer: null, users, sessions: new SessionStore(path.join(dir, "x.json")), settings, audit }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(username) {
    const res = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username, password: "clave-segura-123" }) });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return (url, body) => fetch(base + url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-ops-request": "1", cookie }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  }
  const sup = await login("sup.uno");
  const cap = await login("cap.uno");
  assert.equal((await cap("/operations/api/mia/pause", { paused: true, reason: "x" })).status, 403);
  assert.equal((await sup("/operations/api/mia/pause", { paused: true })).status, 400, "exige motivo");
  const paused = await sup("/operations/api/mia/pause", { paused: true, reason: "Revisión de respuestas" });
  assert.equal(paused.body.mia.paused, true);
  assert.equal(settings.miaPaused(), true);
  assert.equal((await cap("/operations/api/me")).body.mia.paused, true, "todos ven que Mia está en pausa");
  await sup("/operations/api/mia/pause", { paused: false });
  assert.equal(settings.miaPaused(), false);
  assert.deepEqual(audit.list().map(entry => entry.type).filter(type => type.startsWith("mia.")), ["mia.paused", "mia.resumed"]);
  const reloaded = new OpsSettingsStore(path.join(dir, "s.json"), path.join(dir, "i.bin"));
  assert.equal(reloaded.miaStatus().changed_by.username, "sup.uno", "la pausa sobrevive a un reinicio");
});
