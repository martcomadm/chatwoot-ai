import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { CaseStore } from "../src/operations/customer-service/case-store.js";
import { CustomerService } from "../src/operations/customer-service/customer-service.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";

function setup({ open = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-ac-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "ana.atencion", name: "Ana Atención", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 41 });
  users.create({ username: "beto.atencion", name: "Beto Atención", areas: ["atencion"], password: "clave-segura-123", chatwoot_agent_id: 42 });
  users.create({ username: "sergio.super", name: "Sergio", areas: ["supervision"], password: "clave-segura-123" });
  users.create({ username: "ana.captura", name: "Ana Captura", areas: ["captura"], password: "clave-segura-123" });
  const store = new CaseStore(path.join(dir, "cases.json"));
  const assigned = []; const notes = [];
  let isOpen = open;
  const service = new CustomerService({ store, users, chatwoot: { async assignConversation(id, agent) { assigned.push([id, agent]); } }, notifier: { async notify(n) { notes.push(n); } }, isOpen: () => isOpen });
  return { dir, users, store, service, assigned, notes, setOpen: v => { isOpen = v; } };
}

test("rotación: cada caso nuevo va a la siguiente persona y se asigna también en Chatwoot", async () => {
  const { service, assigned, notes } = setup();
  const a = await service.openCase({ conversation_id: 1, kind: "completed_sale", reason: "Pago validado", sale: { sale_id: "S1", customer: { nombre: "Guillermo", telefono: "55" }, sale: { plan: "plan_1" } } });
  const b = await service.openCase({ conversation_id: 2, kind: "specialized", reason: "¿Cuándo me puedo pensionar?", customer: { nombre: "Rosa" } });
  const c = await service.openCase({ conversation_id: 3, kind: "specialized", reason: "x", customer: { nombre: "Luis" } });
  assert.deepEqual([a, b, c].map(x => x.assignee.username), ["ana.atencion", "beto.atencion", "ana.atencion"]);
  assert.deepEqual(assigned, [[1, 41], [2, 42], [3, 41]]);
  assert.equal(a.customer.plan, "plan_1");
  assert.equal(notes[0].title, "Nuevo caso de Atención a Clientes");
  assert.deepEqual(notes[0].to, ["ana.atencion"]);
  assert.match(notes[0].body, /Guillermo · Venta completada/);
});

test("no se duplica: con un caso abierto, un nuevo motivo se anota en el mismo caso", async () => {
  const { service, store } = setup();
  const a = await service.openCase({ conversation_id: 1, kind: "completed_sale", sale: { sale_id: "S1", customer: { nombre: "Guillermo" } } });
  const again = await service.openCase({ conversation_id: 1, kind: "specialized", reason: "Duda de clínica" });
  assert.equal(again.case_id, a.case_id);
  assert.equal(store.list().length, 1);
  assert.equal(again.events.at(-1).type, "case.note");
});

test("fuera de horario el caso espera y se asigna al abrir", async () => {
  const { service, setOpen } = setup({ open: false });
  const a = await service.openCase({ conversation_id: 1, kind: "specialized", customer: { nombre: "Rosa" } });
  assert.equal(a.assignee, null);
  assert.equal(await service.tick(), 0);
  setOpen(true);
  assert.equal(await service.tick(), 1);
  assert.equal(service.store.get(a.case_id).assignee.username, "ana.atencion");
});

test("cliente con trámite completado que vuelve a escribir: caso nuevo con quien lo atendió antes", async () => {
  const { service, store, notes } = setup();
  const first = await service.openCase({ conversation_id: 7, kind: "completed_sale", sale: { sale_id: "S7", customer: { nombre: "Jesús" } } });
  await service.openCase({ conversation_id: 99, kind: "specialized", customer: { nombre: "Otro" } }); // mueve la rotación a Beto
  // Con el caso abierto: solo avisa a su responsable.
  await service.customerWrote(7, "¿Cuál es mi clínica?");
  assert.equal(notes.at(-1).title, "Jesús escribió por WhatsApp");
  service.setStatus(first.case_id, "resolved", { note: "Se le explicó su clínica" });
  const again = await service.customerWrote(7, "Hola, otra duda del pago de noviembre", { sale: { queue: "completed" } });
  assert.notEqual(again.case_id, first.case_id);
  assert.equal(again.kind, "returning");
  assert.equal(again.assignee.username, "ana.atencion", "afinidad con quien lo atendió");
  assert.equal(store.list().length, 3);
  // Un lead normal (sin trámite completado) no abre casos.
  assert.equal(await service.customerWrote(555, "hola", { sale: null }), null);
});

test("Atendido pide nota; sin personas en el área se avisa a Supervisión", async () => {
  const { service, users, notes } = setup();
  const a = await service.openCase({ conversation_id: 1, kind: "specialized", customer: { nombre: "Rosa" } });
  assert.throws(() => service.setStatus(a.case_id, "resolved", {}), /qué se resolvió/);
  users.update("ana.atencion", { active: false }); users.update("beto.atencion", { active: false });
  const b = await service.openCase({ conversation_id: 2, kind: "specialized", customer: { nombre: "Luis" } });
  assert.equal(b.assignee, null);
  assert.equal(notes.at(-1).title, "Caso de Atención a Clientes sin responsable");
  assert.deepEqual(notes.at(-1).to, ["sergio.super"]);
});

test("API: Atención ve y trabaja sus casos; Captura no tiene acceso; Supervisión reasigna", async t => {
  const env = setup();
  const saleStore = new SaleStore(path.join(env.dir, "s.json"));
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users: env.users, sessions: new SessionStore(path.join(env.dir, "se.json")), settings: new OpsSettingsStore(path.join(env.dir, "st.json"), path.join(env.dir, "img.bin")), audit: new OpsAuditStore(path.join(env.dir, "a.json")), customerService: env.service, chatwoot: { async getAllMessages() { return { payload: [{ id: 1, message_type: 0, content: "Hola", created_at: 10 }] }; } } }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  const c = await env.service.openCase({ conversation_id: 5, kind: "specialized", reason: "Pensión", customer: { nombre: "Rosa" } });
  const ana = await as("ana.atencion"); const beto = await as("beto.atencion"); const sup = await as("sergio.super"); const cap = await as("ana.captura");
  assert.equal((await ana("/operations/api/cases")).body.items.length, 1);
  assert.equal((await cap("/operations/api/cases")).status, 403);
  const detail = await ana(`/operations/api/cases/${c.case_id}`);
  assert.match(detail.body.links.chatwoot, /conversations\/5/);
  assert.equal(detail.body.can.work, true);
  assert.equal((await ana(`/operations/api/cases/${c.case_id}/conversation`)).body.items[0].text, "Hola");
  assert.equal((await beto(`/operations/api/cases/${c.case_id}/status`, { status: "in_progress" })).status, 403, "no es su caso");
  assert.equal((await ana(`/operations/api/cases/${c.case_id}/status`, { status: "resolved", note: "Listo" })).status, 200);
  assert.equal((await beto(`/operations/api/cases/${c.case_id}/assign`, { username: "beto.atencion" })).status, 403);
  const re = await sup(`/operations/api/cases/${c.case_id}/assign`, { username: "beto.atencion" });
  assert.equal(re.status, 200);
  assert.equal(re.body.case.assignee.username, "beto.atencion");
  assert.deepEqual(env.assigned.at(-1), [5, 42]);
});

test("pago validado: el bridge abre el caso de Atención a Clientes", async () => {
  const { ChatwootWorkflowBridge } = await import("../src/operations/chatwoot-workflow-bridge.js");
  const opened = [];
  const bridge = new ChatwootWorkflowBridge({ saleStore: { on() {} }, chatwoot: { async sendMessage() {}, async assignTeam() {} }, labels: { async finalizeForCustomerService() {} }, memories: { get: () => ({}), async merge() {} }, inspectorEvents: { async record() {} }, customerServiceTeamId: 3 });
  bridge.onCompletedSale = sale => { opened.push(sale.sale_id); };
  await bridge.handle({ type: "payment.validated", sale: { sale_id: "S1", conversation_id: 9, queue: "completed", status: "completed", sale: { plan: "plan_1" }, payment: { validated: true }, documents: {} } });
  assert.deepEqual(opened, ["S1"]);
});
