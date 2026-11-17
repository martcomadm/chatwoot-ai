// Mia libre (17-nov): la API separa sus chats y expedientes; solo quien tiene el permiso los ve y los trabaja.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { MemoryStore } from "../src/memory/memory-store.js";
import { InspectorEventStore } from "../src/inspector/event-store.js";
import { MiaConsole } from "../src/inspector/mia-console.js";

test("API de Mia libre: chats, expedientes, resumen y acciones solo con el permiso", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-libre-router-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "axel.libre", name: "Axel", areas: ["mia_libre"], password: "clave-segura-123" });
  users.create({ username: "carla.captura", name: "Carla", areas: ["captura"], password: "clave-segura-123" });
  users.create({ username: "ana.admin", name: "Ana", areas: ["admin"], password: "clave-segura-123" });
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"));
  await memories.merge(20, { nombre: "Libre", mia_mode: "light", sales_cycle: { stage: "explaining" } });
  await memories.merge(21, { nombre: "Normal", mia_mode: "full", sales_cycle: { stage: "explaining" } });
  await events.record(20, "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola!", decision_source: "llm" });
  await events.record(21, "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola!", decision_source: "progressive_opening" });
  const chatwoot = { async assignConversation() {}, async sendMessage() {}, async getConversation(id) { return { id, meta: { sender: { phone_number: null } } }; }, async getAllMessages() { return { payload: [] }; }, async getMessages() { return { payload: [] }; } };
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const libre = saleStore.create({ conversation_id: 20, origin: "mia_libre", customer: { nombre: "Libre" }, sale: { plan: "plan_1", authorized: true }, status: "waiting_capture", queue: "capture" });
  const normal = saleStore.create({ conversation_id: 21, customer: { nombre: "Normal" }, sale: { plan: "plan_1", authorized: true }, status: "waiting_capture", queue: "capture" });
  const miaConsole = new MiaConsole({ config: { ai: {} }, memories, inspectorEvents: events, chatwoot, saleStore });
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", ai: { lightShare: 20 }, operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories, inspectorEvents: events, buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit: new OpsAuditStore(path.join(dir, "a.json")), chatwoot, miaConsole }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async u => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: u, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async (p, body) => {
      const r = await fetch(base + p, body === undefined ? { headers: { cookie } } : { method: "POST", headers: { cookie, "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
  };
  const axel = await as("axel.libre"); const carla = await as("carla.captura"); const ana = await as("ana.admin");

  const axelMe = (await axel("/operations/api/me")).body;
  assert.ok(axelMe.areas.some(a => a.key === "mia_libre")); assert.equal(axelMe.can.libre, true);
  assert.ok(!(await ana("/operations/api/me")).body.areas.some(a => a.key === "mia_libre"), "Admin no lo tiene por su rol");

  // Expedientes: Captura y Admin no ven el de Mia libre; Axel sí, en su sección.
  assert.deepEqual((await carla("/operations/api/sales")).body.items.map(s => s.sale_id), [normal.sale_id]);
  assert.ok(!(await ana("/operations/api/sales")).body.items.some(s => s.sale_id === libre.sale_id));
  assert.equal((await carla(`/operations/api/sales/${libre.sale_id}`)).status, 403);
  assert.deepEqual((await axel("/operations/api/sales?origin=mia_libre")).body.items.map(s => s.sale_id), [libre.sale_id]);
  assert.equal((await carla("/operations/api/sales?origin=mia_libre")).status, 403);
  assert.equal((await axel(`/operations/api/sales/${libre.sale_id}`)).status, 200);
  // Axel lo trabaja completo aunque no sea de Captura; Carla no puede.
  assert.equal((await carla(`/operations/api/sales/${libre.sale_id}/capture/start`, {})).status, 403);
  assert.equal((await axel(`/operations/api/sales/${libre.sale_id}/capture/start`, {})).status, 200);

  // Chats: los de Mia libre no salen en Chats de Mia; solo en su sección.
  assert.deepEqual((await carla("/operations/api/mia-chats?filter=all")).body.items.map(c => c.id), [21]);
  assert.equal((await carla("/operations/api/mia-chats?libre=1")).status, 403);
  assert.deepEqual((await axel("/operations/api/mia-chats?libre=1&filter=all")).body.items.map(c => c.id), [20]);
  assert.equal((await carla("/operations/api/mia-chats/20/conversation")).status, 403);
  assert.equal((await carla("/operations/api/mia-chats/20/intervene", {})).status, 403);

  const summary = await axel("/operations/api/mia-libre/summary?days=7");
  assert.equal(summary.status, 200); assert.equal(summary.body.share, 20); assert.equal(summary.body.sales.total, 1);
  assert.equal((await carla("/operations/api/mia-libre/summary")).status, 403);
});
