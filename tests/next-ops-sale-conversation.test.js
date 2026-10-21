import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import express from "express";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-ops-chat-"));
  const users = new UserStore(path.join(dir, "u.json"));
  for (const [u, a] of [["ana.captura", ["captura"]], ["carla.cobra", ["cobranza"]], ["sergio.super", ["supervision"]], ["olga.observa", ["observador"]]]) users.create({ username: u, name: u, areas: a, password: "clave-segura-123" });
  const saleStore = new SaleStore(path.join(dir, "s.json")); const workflow = new SaleWorkflowEngine(saleStore);
  const sale = workflow.openAuthorizedSale({ conversation_id: 77, customer: { nombre: "Enedino" }, sale: { plan: "plan_1", authorized: true } });
  const chatwoot = { async getAllMessages() { return { payload: [
    { id: 1, message_type: 0, content: "", created_at: 100, attachments: [{ file_type: "image", data_url: "https://chat/ine.jpg", thumb_url: "https://chat/ine-thumb.jpg" }] },
    { id: 2, message_type: 1, content: "Gracias, recibí tus documentos.", created_at: 110, sender: { id: 53, type: "user" } },
    { id: 3, message_type: 1, content: "Resumen interno para el asesor", private: true, created_at: 120 },
    { id: 4, message_type: 1, content: "🎤 Transcripción de la nota de voz del cliente:\n«ya se la mandé»", private: true, created_at: 130 },
    { id: 5, message_type: 1, content: "Buenas tardes", created_at: 140, sender: { id: 88, type: "user", name: "Pamela Montiel" } },
  ] }; } };
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow, memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit: new OpsAuditStore(path.join(dir, "a.json")), chatwoot }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = async username => {
    const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username, password: "clave-segura-123" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    return async p => { const r = await fetch(base + p, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  };
  return { sale, as };
}

test("el expediente muestra la conversación; 'Abrir en Chatwoot' solo para Supervisión y Cobranza", async t => {
  const { sale, as } = await setup(t);
  const ana = await as("ana.captura");
  const detail = await ana(`/operations/api/sales/${sale.sale_id}`);
  assert.equal(detail.body.links.chatwoot, null, "Captura no ve el enlace a Chatwoot");
  const chat = await ana(`/operations/api/sales/${sale.sale_id}/conversation`);
  assert.equal(chat.status, 200);
  assert.deepEqual(chat.body.items.map(m => m.who), ["cliente", "mia", "nota", "persona"]);
  assert.equal(chat.body.items[0].attachments[0].url, "https://chat/ine.jpg");
  assert.ok(!chat.body.items.some(m => /Resumen interno/.test(m.text)), "sin notas privadas");
  assert.equal(chat.body.items[3].name, "Pamela Montiel");
  for (const u of ["sergio.super"]) assert.match((await (await as(u))(`/operations/api/sales/${sale.sale_id}`)).body.links.chatwoot, /conversations\/77/);
  const observer = await as("olga.observa");
  assert.equal((await observer(`/operations/api/sales/${sale.sale_id}`)).body.links.chatwoot, null);
  assert.equal((await observer(`/operations/api/sales/${sale.sale_id}/conversation`)).status, 200);
  const cobra = await as("carla.cobra");
  assert.equal((await cobra(`/operations/api/sales/${sale.sale_id}/conversation`)).status, 403, "Cobranza no ve expedientes de Captura");
});
