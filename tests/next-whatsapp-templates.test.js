import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WhatsAppTemplates, replyWindowOpen, TEMPLATE_TEXTS } from "../src/chatwoot/whatsapp-templates.js";
import { FollowUpStore, FollowUpService } from "../src/core/follow-up.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { ChatwootWorkflowBridge } from "../src/operations/chatwoot-workflow-bridge.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { loadConfig, DEFAULT_HANDOFF_AGENTS } from "../src/config.js";
import { OperationsConfigStore } from "../src/handoff/operations-config-store.js";

const NAMES = { validity: "vigencia1", referral: "recomendacion2", followUp24h: "saludodia3" };
const CATALOG = [
  { friendly_name: "vigencia1", language: "es_MX", status: "approved", category: "utility", body: TEMPLATE_TEXTS.validity, content_sid: "HX66fc" },
  { friendly_name: "recomendacion2", language: "es_MX", status: "approved", category: "marketing", body: TEMPLATE_TEXTS.referral, content_sid: "HXfa7e" },
  { friendly_name: "saludodia3", language: "es_MX", status: "approved", category: "marketing", body: TEMPLATE_TEXTS.followUp24h, content_sid: "HX7b02" },
];

function templatesWith(sentTemplates, catalog = CATALOG) {
  return new WhatsAppTemplates({
    chatwoot: { async getInbox() { return { content_templates: { templates: catalog } }; }, async sendTemplate(id, t) { sentTemplates.push({ id, ...t }); } },
    inboxId: 7, names: NAMES,
  });
}

test("ventana de 24 h: usa can_reply de Chatwoot y, si no viene, el último mensaje del cliente", () => {
  assert.equal(replyWindowOpen({ can_reply: false }), false);
  assert.equal(replyWindowOpen({ can_reply: true }), true);
  const now = Date.parse("2026-10-15T18:00:00Z");
  assert.equal(replyWindowOpen({ messages: [{ message_type: 0, created_at: now / 1000 - 3600 }] }, now), true);
  assert.equal(replyWindowOpen({ messages: [{ message_type: 0, created_at: now / 1000 - 25 * 3600 }] }, now), false);
});

test("plantillas: se envían con el nombre e idioma sincronizados en el inbox", async () => {
  const sent = [];
  assert.deepEqual(await templatesWith(sent).send(10, "followUp24h"), { sent: true, name: "saludodia3" });
  assert.deepEqual(sent[0], { id: 10, content: TEMPLATE_TEXTS.followUp24h, name: "saludodia3", language: "es_MX", category: "marketing" });
  const missing = await templatesWith([], CATALOG.slice(1)).send(10, "validity");
  assert.equal(missing.reason, "template_not_synced");
  const off = new WhatsAppTemplates({ chatwoot: {}, inboxId: 7, names: { ...NAMES, referral: "" } });
  assert.equal((await off.send(10, "referral")).reason, "disabled");
});

test("rotación predeterminada toda la semana: Pamela, Adriana, Jonathan y Alberto", () => {
  const base = { CHATWOOT_BASE_URL: "http://x", CHATWOOT_API_TOKEN: "t", CHATWOOT_ACCOUNT_ID: "1", CHATWOOT_INBOX_ID: "7", CHATWOOT_AI_AGENT_ID: "53", OPENAI_API_KEY: "k", APP_ENV: "next", ALLOWED_INBOX_IDS: "7", NEXT_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "next-cfg-")) };
  const keys = [...Object.keys(base), "HANDOFF_WEEKDAY_AGENTS", "HANDOFF_SATURDAY_AGENTS", "HANDOFF_SUNDAY_AGENTS", "TEMPLATE_VALIDITY", "TEMPLATE_REFERRAL", "TEMPLATE_FOLLOWUP_24H"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, base);
  for (const k of keys.slice(Object.keys(base).length)) delete process.env[k];
  try {
    let config;
    for (let i = 0; i < 30 && !config; i++) {
      try { config = loadConfig(); }
      catch (error) {
        const key = /obligatoria (\w+)/.exec(error.message)?.[1];
        if (!key) throw error;
        saved[key] ??= process.env[key];
        process.env[key] = key.endsWith("_ID") ? "53" : "x";
      }
    }
    for (const group of ["weekdayAgents", "saturdayAgents", "sundayAgents"]) assert.deepEqual(config.handoff[group].map(a => a.id), [26, 24, 20, 40], group);
    assert.deepEqual(config.whatsappTemplates, NAMES);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ── Seguimiento de 24 h ──
const MIN = 60 * 1000;
const T0 = new Date("2026-10-12T16:00:00Z");
const at = minutes => new Date(T0.getTime() + minutes * MIN);
const secs = d => Math.floor(d.getTime() / 1000);

function followUpSetup({ isOpen = () => true, memory = {} } = {}) {
  const state = { sent: [], labels: [], events: [], templates: [] };
  const conversation = { id: 5, inbox_id: 7, status: "open", labels: [], meta: { assignee: { id: 53 } }, messages: [
    { id: 1, message_type: 0, content: "Hola", created_at: secs(at(-1)), private: false },
    { id: 2, message_type: 1, content: "¡Hola! Soy Mia de MARTCOM…", created_at: secs(T0), private: false, sender_type: "User", sender: { id: 1, type: "user" } },
  ] };
  const service = new FollowUpService({
    store: new FollowUpStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-fu24-")), "f.json")),
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { state.sent.push(text); conversation.messages.push({ id: 100 + state.sent.length, message_type: 1, content: text, created_at: secs(new Date()), private: false, sender_type: "User", sender: { id: 1, type: "user" } }); } },
    labels: { async mergeSafe(_id, add) { state.labels.push(...add); return add; } },
    memories: { get: () => structuredClone(memory), async set() {} },
    config: { chatwoot: { inboxId: 7, agentId: 53 } },
    inspectorEvents: { async record(_id, type, data) { state.events.push({ type, data }); } },
    isOpen, templates: templatesWith(state.templates),
  });
  service.afterReply(5, { customerAt: at(-1), now: T0, reply: "¡Hola! Soy Mia de MARTCOM…" });
  return { service, state };
}

test("al cerrarse la ventana de 24 h sin respuesta, Mia manda la plantilla 'saludodia3' una vez y pone 'no_contesta'", async () => {
  const { service, state } = followUpSetup();
  for (const m of [20, 180, 1200]) await service.tick(at(m));
  assert.equal(state.sent.length, 3);
  await service.tick(at(24 * 60));
  assert.equal(state.templates.length, 1);
  assert.equal(state.templates[0].name, "saludodia3");
  assert.deepEqual(state.labels, ["no_contesta"]);
  await service.tick(at(26 * 60));
  assert.equal(state.templates.length, 1, "no se repite");
});

test("si la ventana se cierra de noche, la plantilla espera a la apertura", async () => {
  let open = true;
  const { service, state } = followUpSetup({ isOpen: () => open });
  for (const m of [20, 180, 1200]) await service.tick(at(m));
  open = false;
  await service.tick(at(24 * 60));
  assert.equal(state.templates.length, 0);
  open = true;
  await service.tick(at(24 * 60 + 300));
  assert.equal(state.templates.length, 1);
});

// ── Vigencia fuera de las 24 h ──
function bridgeFixture({ canReply }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-vig-"));
  const store = new SaleStore(path.join(dir, "sales.json"));
  const workflow = new SaleWorkflowEngine(store);
  const calls = { attachments: [], texts: [], templates: [], events: [], memory: {} };
  const window = { open: canReply };
  const chatwoot = {
    async getConversation() { return { can_reply: window.open }; },
    async sendMessage(id, content) { calls.texts.push({ id, content }); },
    async sendMessageWithAttachment(id, content, attachment) { calls.attachments.push({ id, content, filename: attachment.filename }); },
    async assignTeam() {},
    async getInbox() { return { content_templates: { templates: CATALOG } }; },
    async sendTemplate(id, t) { calls.templates.push({ id, ...t }); },
  };
  const bridge = new ChatwootWorkflowBridge({
    saleStore: store, chatwoot, labels: {},
    memories: { get: () => calls.memory, async merge(_id, patch) { calls.memory = { ...calls.memory, ...patch }; } },
    inspectorEvents: { async record(_id, type, data) { calls.events.push({ type, data }); } },
    templates: new WhatsAppTemplates({ chatwoot, inboxId: 7, names: NAMES }),
  });
  return { store, workflow, bridge, calls, window };
}

function readyForValidity(workflow) {
  const sale = workflow.openAuthorizedSale({ conversation_id: 902, customer: { nombre: "Ana", curp: "CURP", nss: "NSS" }, sale: { plan: "plan_2", precio: 1500, authorized: true }, documents: { files: [{ id: "ine", type: "ine", name: "INE.pdf" }, { id: "csf", type: "csf", name: "CSF.pdf" }] } });
  workflow.completeCapture(sale.sale_id);
  for (const key of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, key, true, { by: "Validador" });
  return workflow.mustGet(sale.sale_id);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const pdf = { document_name: "vigencia.pdf", document_base64: Buffer.from("pdf").toString("base64"), document_content_type: "application/pdf" };

test("vigencia fuera de 24 h: manda 'vigencia1', espera la respuesta y entonces entrega el documento una sola vez", async () => {
  const { store, workflow, bridge, calls, window } = bridgeFixture({ canReply: false });
  bridge.start();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, pdf);
  await settle();
  assert.equal(calls.attachments.length, 0, "no se manda el PDF fuera de la ventana");
  assert.equal(calls.templates.length, 1);
  assert.equal(calls.templates[0].name, "vigencia1");
  assert.equal(store.get(sale.sale_id).validity.awaiting_customer_reply, true);

  // El reintento periódico no lo manda mientras la ventana siga cerrada.
  await bridge.retryPendingDeliveries();
  assert.equal(calls.attachments.length, 0);

  // El cliente contesta.
  window.open = true;
  const [a, b] = await Promise.all([bridge.deliverAwaitingValidity(902), bridge.deliverAwaitingValidity(902)]);
  assert.deepEqual([a, b].sort(), [false, true]);
  await settle();
  assert.equal(calls.attachments.length, 1);
  assert.match(calls.attachments[0].content, /vigente/);
  assert.equal(store.get(sale.sale_id).validity.delivered_to_customer, true);
});

test("vigencia con el cliente dentro de 24 h: se entrega directo, sin plantilla", async () => {
  const { workflow, bridge, calls } = bridgeFixture({ canReply: true });
  bridge.start();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, pdf);
  await settle();
  assert.equal(calls.templates.length, 0);
  assert.equal(calls.attachments.length, 1);
});

test("si el webhook se pierde, el reintento entrega la vigencia cuando la ventana se reabre", async () => {
  const { workflow, bridge, calls, window } = bridgeFixture({ canReply: false });
  bridge.start();
  const sale = readyForValidity(workflow);
  workflow.confirmValidity(sale.sale_id, pdf);
  await settle();
  window.open = true;
  await bridge.retryPendingDeliveries();
  await settle();
  assert.equal(calls.attachments.length, 1);
});

test("recomendación al terminar: texto dentro de 24 h, plantilla fuera, y una sola vez", async () => {
  const inside = bridgeFixture({ canReply: true });
  await inside.bridge.sendReferral(902, { sale_id: "S1" });
  await inside.bridge.sendReferral(902, { sale_id: "S1" });
  assert.deepEqual(inside.calls.texts.map(t => t.content), [TEMPLATE_TEXTS.referral]);
  const outside = bridgeFixture({ canReply: false });
  await outside.bridge.sendReferral(902, { sale_id: "S1" });
  assert.equal(outside.calls.templates[0].name, "recomendacion2");
  assert.equal(outside.calls.texts.length, 0);
});

test("respuesta a la plantilla de vigencia con etiqueta 'validacion': entrega el documento y Mia no conversa", async () => {
  const sent = [];
  const replies = [];
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 72, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: ["validacion"], messages: [{ id: 950, message_type: 0, content: "Sí, gracias", private: false, attachments: [], sender: { type: "contact" } }] }; }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({}), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "NO DEBE SALIR" }) },
    inspectorEvents: { async record() {} }, handoffRouter: {},
    workflow: { store: { findByConversationId: () => ({ sale_id: "S1", status: "validity_confirmed", validity: { awaiting_customer_reply: true } }) } },
  });
  processor.onValidityReply = async id => { replies.push(id); return true; };
  await processor.process(72, { ids: ["950"], webhookMessages: new Map() });
  assert.deepEqual(replies, [72]);
  assert.equal(sent.length, 0);
});

test("la rotación guardada de fin de semana (la vieja predeterminada) pasa a los 4 asesores; una editada a mano se respeta", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-rot-")), "handoff-config.json");
  const agents = DEFAULT_HANDOFF_AGENTS.split(",").map(item => { const [id, name] = item.split(":"); return { id: Number(id), name }; });
  fs.writeFileSync(file, JSON.stringify({ groups: {
    weekday: [],
    saturday: [{ id: 40, name: "Alberto Gonzalez" }, { id: 26, name: "Pamela Montiel" }, { id: 32, name: "Vicente Martinez" }],
    sunday: [{ id: 25, name: "Elizabeth Aguilera" }, { id: 20, name: "Jonathan Nuñez" }, { id: 31, name: "Tonatiuh Ramirez" }],
  } }));
  const store = new OperationsConfigStore(file, { weekday: agents, saturday: agents, sunday: agents });
  for (const group of ["weekday", "saturday", "sunday"]) assert.deepEqual(store.agentsFor(group).map(a => a.id), [26, 24, 20, 40], group);
  assert.ok(store.snapshot().audit.some(e => e.type === "rotation_defaults_migrated"));

  fs.writeFileSync(file, JSON.stringify({ groups: { saturday: [{ id: 40, name: "Alberto Gonzalez" }] } }));
  assert.deepEqual(new OperationsConfigStore(file, { weekday: agents, saturday: agents, sunday: agents }).agentsFor("saturday").map(a => a.id), [40]);
});
