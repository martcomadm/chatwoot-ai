import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { CaseStore } from "../src/operations/customer-service/case-store.js";
import { CustomerService } from "../src/operations/customer-service/customer-service.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { HandoffRotationStore, HandoffRouter } from "../src/handoff/index.js";

// 6-nov: "que todos los casos que se están yendo a Atención a Clientes se vean bien reflejados". Antes solo
// se veían los que Mia canalizaba como "especializados" y las ventas completadas; la atención humana
// (Jaqueline, Erika, Brenda) y lo asignado a mano en Chatwoot no aparecía en Operations.

function setup(list = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-reflect-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "jaqueline", name: "Jaqueline Juárez", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 62 });
  users.create({ username: "erika", name: "Erika Balanzario", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 58 });
  const store = new CaseStore(path.join(dir, "cases.json"));
  const assigned = []; const notes = [];
  const chatwoot = {
    async assignConversation(id, agent) { assigned.push([id, agent]); return { id: agent }; },
    async listConversations({ page }) { return page === 1 ? { data: { payload: list } } : { data: { payload: [] } }; },
  };
  const service = new CustomerService({ store, users, chatwoot, notifier: { async notify(n) { notes.push(n); } }, isOpen: () => true });
  return { store, service, assigned, notes };
}

test("caso con quien ya tiene la conversación: si es del área se le asigna sin moverla en Chatwoot", async () => {
  const { service, assigned, notes } = setup();
  const c = await service.openCase({ conversation_id: 10, kind: "human_request", reason: "El cliente solicitó atención humana.", customer: { nombre: "Rosa" }, assignTo: { id: 58, name: "Erika Balanzario" } });
  assert.equal(c.assignee.username, "erika");
  assert.equal(c.kind, "human_request");
  assert.deepEqual(assigned, [], "ya la tenía en Chatwoot");
  assert.deepEqual(notes.map(n => n.to), [["erika"]]);
  // Alguien que no está en el área: se muestra su nombre y Atención lo puede tomar.
  const d = await service.openCase({ conversation_id: 11, kind: "human_request", reason: "x", assignTo: { id: 59, name: "Brenda Torres" } });
  assert.equal(d.assignee.name, "Brenda Torres");
  assert.equal(d.assignee.username, null);
  const taken = await service.assign(d, { username: "jaqueline" });
  assert.equal(taken.assignee.username, "jaqueline");
  assert.deepEqual(assigned, [[11, 62]]);
});

test("sincroniza con Chatwoot lo que ya está con Atención y no tiene caso", async () => {
  const now = Date.parse("2026-11-06T15:00:00Z");
  const recent = Math.floor(now / 1000) - 3600;
  const list = [
    { id: 1, inbox_id: 7, last_activity_at: recent, meta: { team: { id: 9 }, assignee: null, sender: { name: "Team sin persona" } } },
    { id: 2, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 62, name: "Jaqueline Juárez" }, sender: { name: "Asignado a mano" } } },
    { id: 3, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 59, name: "Brenda Torres" }, sender: { name: "Rotación humana" } } },
    { id: 4, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 53, name: "Mia" } } },
    { id: 5, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 26, name: "Pamela (ventas)" } } },
    { id: 6, inbox_id: 7, last_activity_at: Math.floor(now / 1000) - 10 * 86400, meta: { assignee: { id: 62, name: "Jaqueline Juárez" } } },
    { id: 7, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 58, name: "Erika Balanzario" } } },
    { id: 8, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 58, name: "Erika Balanzario" } }, last_non_activity_message: { message_type: 1, created_at: recent } },
    { id: 9, inbox_id: 7, last_activity_at: recent, meta: { assignee: { id: 58, name: "Erika Balanzario" } }, last_non_activity_message: { message_type: 0, created_at: recent } },
    { id: 12, inbox_id: 99, last_activity_at: recent, meta: { assignee: { id: 62, name: "Jaqueline Juárez" } } },
  ];
  const { store, service, assigned, notes } = setup(list);
  await service.openCase({ conversation_id: 7, kind: "specialized", reason: "ya abierto" });
  for (const id of [8, 9]) {
    const c = await service.openCase({ conversation_id: id, kind: "specialized", reason: "viejo" });
    store.update(c.case_id, { status: "resolved", resolved_at: new Date(now - 2 * 86400e3).toISOString() }, "case.resolved");
  }
  assigned.length = 0; notes.length = 0;
  const result = await service.syncFromChatwoot({ teamId: 9, inboxId: 7, miaAgentId: 53, extraAgentIds: [62, 58, 59], now });
  assert.equal(result.created, 4);
  const byConv = id => store.openForConversation(id);
  assert.equal(byConv(1).kind, "chatwoot");
  assert.match(byConv(1).reason, /equipo de Atención/);
  assert.ok(byConv(1).assignee.username, "equipo sin persona → rotación");
  assert.equal(byConv(2).assignee.username, "jaqueline");
  assert.equal(byConv(3).assignee.name, "Brenda Torres");
  assert.equal(byConv(4), null, "Mia");
  assert.equal(byConv(5), null, "ventas");
  assert.equal(byConv(6), null, "sin movimiento en 7 días");
  assert.equal(byConv(7).kind, "specialized", "ya tenía caso");
  assert.equal(byConv(8), null, "atendido y el cliente no volvió a escribir");
  assert.equal(byConv(9).kind, "chatwoot", "atendido pero el cliente volvió a escribir");
  assert.equal(byConv(12), null, "otro inbox");
  assert.equal(assigned.filter(([id]) => id === 2).length, 0, "no se mueve la conversación de Jaqueline");
  assert.ok(!notes.some(n => n.to?.includes("jaqueline") && /Asignado a mano/.test(n.body)), "sin avisos por lo que ya tenían");
  // Otra vuelta no duplica.
  assert.equal((await service.syncFromChatwoot({ teamId: 9, inboxId: 7, miaAgentId: 53, extraAgentIds: [62, 58, 59], now })).created, 0);
});

test("Mia pasa a atención humana → también abre caso de Atención con quien quedó", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-reflect-h-"));
  const cfg = agents => ({ ai: { timezone: "America/Mexico_City" }, handoff: { enabled: true, weekdayAgents: agents, saturdayAgents: agents, sundayAgents: agents } });
  const chatwoot0 = { async assignConversation(_id, agent) { return { id: agent }; } };
  const humanHandoffRouter = new HandoffRouter({ config: cfg([{ id: 59, name: "Brenda Torres" }]), store: new HandoffRotationStore(path.join(dir, "h.json")), chatwoot: chatwoot0 });
  const handoffRouter = new HandoffRouter({ config: cfg([{ id: 26, name: "Pamela" }]), store: new HandoffRotationStore(path.join(dir, "a.json")), chatwoot: chatwoot0 });
  const cases = [];
  const run = (text, id) => {
    const msgs = [{ id: 900 + id, message_type: 0, content: text, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 }];
    const processor = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage() {}, async getMessages() { return { payload: msgs }; }, assignConversation: chatwoot0.assignConversation },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => ({ presentacion_realizada: true, ultima_respuesta_agente: "x", nombre: "Rosa" }), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "resumen" },
      inspectorEvents: { async record() {} }, handoffRouter, humanHandoffRouter, workflow: null,
    });
    processor.onCustomerServiceCase = input => { cases.push(input); };
    return processor.process(id, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) });
  };
  await run("Quiero hablar con un asesor humano", 1);
  await run("Le puedo marcar xfa", 2);
  assert.equal(cases.length, 1, "las llamadas van con asesores, no son caso de Atención");
  assert.equal(cases[0].kind, "human_request");
  assert.equal(cases[0].conversation_id, 1);
  assert.deepEqual(cases[0].assignTo, { id: 59, name: "Brenda Torres" });
  assert.equal(cases[0].customer.nombre, "Rosa");
});
