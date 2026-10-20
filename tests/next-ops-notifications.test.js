import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { OpsNotifier } from "../src/operations/notifications/ops-notifier.js";
import { PushStore } from "../src/operations/notifications/push-store.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";
import { createOperationsRouter } from "../src/operations/operations-router.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "next-ops-notify-"));

function team(dir) {
  const users = new UserStore(path.join(dir, "u.json"));
  for (const [username, areas] of [["ana.captura", ["captura"]], ["vale.valida", ["validacion"]], ["vico.vigencia", ["vigencia"]], ["carla.cobra", ["cobranza"]], ["sergio.super", ["supervision"]], ["olga.observa", ["observador"]], ["axel.admin", ["admin"]]]) {
    users.create({ username, name: username, areas, password: "clave-segura-123" });
  }
  return users;
}

function setup() {
  const dir = tmp();
  const users = team(dir);
  const store = new PushStore(path.join(dir, "push.json"));
  const pushes = [];
  const notifier = new OpsNotifier({ users, store, settings: { alertHours: () => ({ capture: 2, validation: 4, validity: 24, payment: 24 }) }, sendPush: async (sub, payload) => { pushes.push({ endpoint: sub.endpoint, payload }); return { ok: true, status: 201, gone: sub.endpoint.includes("gone") }; } });
  const inPage = [];
  notifier.on("notify", n => inPage.push(n));
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const workflow = new SaleWorkflowEngine(saleStore);
  saleStore.on("sale", e => void notifier.handleSaleEvent(e));
  return { dir, users, store, notifier, pushes, inPage, saleStore, workflow };
}
const flush = () => new Promise(r => setTimeout(r, 10));
const sub = endpoint => ({ endpoint, keys: { p256dh: "BOr".padEnd(87, "A"), auth: "abcdefghijklmnopqrstuv" } });

test("cada área recibe el aviso cuando el expediente llega a su cola", async () => {
  const { workflow, inPage } = setup();
  const sale = workflow.openAuthorizedSale({ conversation_id: 1, customer: { nombre: "María López", curp: "XEXX010101HNEXXXA4", nss: "12345678901" }, sale: { plan: "plan_1", precio: 1100, authorized: true } });
  await flush();
  assert.deepEqual(inPage.at(-1).to, ["ana.captura"]);
  assert.equal(inPage.at(-1).title, "Nueva venta para Captura");
  assert.equal(inPage.at(-1).body, "María López · Plan 1");
  workflow.completeCapture(sale.sale_id); await flush();
  assert.deepEqual(inPage.at(-1).to, ["vale.valida"]);
  for (const k of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, k, true, {});
  await flush();
  assert.deepEqual(inPage.at(-1).to, ["vico.vigencia"]);
  workflow.confirmValidity(sale.sale_id, { document_name: "v.pdf" }); await flush();
  assert.deepEqual(inPage.at(-1).to, ["carla.cobra"]);
  assert.ok(!inPage.some(n => n.to.includes("olga.observa") || n.to.includes("axel.admin")), "Observador y Admin no reciben avisos de colas");
});

test("asignación, rechazo y comprobante llegan a quien corresponde; nadie recibe aviso de lo que él hizo", async () => {
  const { workflow, saleStore, inPage } = setup();
  const sale = workflow.openAuthorizedSale({ conversation_id: 2, customer: { nombre: "Jesús", curp: "XEXX010101HNEXXXA4", nss: "12345678901" }, sale: { plan: "plan_1", authorized: true } });
  saleStore.runAs({ username: "sergio.super", name: "Sergio" }, () => workflow.assign(sale.sale_id, { username: "ana.captura", name: "Ana" }));
  await flush();
  assert.equal(inPage.at(-1).title, "Te asignaron un expediente");
  assert.deepEqual(inPage.at(-1).to, ["ana.captura"]);
  const before = inPage.length;
  saleStore.runAs({ username: "ana.captura", name: "Ana" }, () => workflow.assign(sale.sale_id, { username: "ana.captura", name: "Ana" }));
  await flush();
  assert.equal(inPage.length, before, "tomar tu propio expediente no te avisa");
  workflow.completeCapture(sale.sale_id);
  workflow.rejectValidation(sale.sale_id, { reason: "INE ilegible" }); await flush();
  assert.equal(inPage.at(-1).title, "Validación rechazada");
  assert.deepEqual(inPage.at(-1).to.sort(), ["ana.captura", "sergio.super"]);
  assert.match(inPage.at(-1).body, /INE ilegible/);
});

test("el cliente escribió: aviso a quien tiene el expediente, máximo uno cada 10 min", async () => {
  const { notifier, inPage } = setup();
  const sale = { sale_id: "S9", queue: "payment", customer: { nombre: "Guillermo" }, assignee: { username: "carla.cobra" } };
  await notifier.customerMessage(sale, "Ya hice el depósito", 1000);
  await notifier.customerMessage(sale, "¿lo recibieron?", 2000);
  assert.equal(inPage.length, 1);
  assert.equal(inPage[0].title, "Guillermo escribió por WhatsApp");
  assert.deepEqual(inPage[0].to, ["carla.cobra"]);
  await notifier.customerMessage(sale, "hola", 1000 + 11 * 60 * 1000);
  assert.equal(inPage.length, 2);
});

test("atrasos: un solo aviso por etapa, a su área y a Supervisión", async () => {
  const { notifier, inPage } = setup();
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const sales = [{ sale_id: "S1", queue: "capture", status: "waiting_capture", queue_entered_at: old, customer: { nombre: "Rosa" } }];
  assert.equal(await notifier.checkOverdue(sales), 1);
  assert.equal(await notifier.checkOverdue(sales), 0);
  assert.equal(inPage[0].title, "Expediente atrasado en Captura");
  assert.deepEqual(inPage[0].to.sort(), ["ana.captura", "sergio.super"]);
});

test("Web Push a cada dispositivo de la persona; las suscripciones vencidas se borran", async () => {
  const { notifier, store, pushes } = setup();
  store.add("carla.cobra", sub("https://push.example.com/phone"));
  store.add("carla.cobra", sub("https://push.example.com/gone-laptop"));
  const r = await notifier.notify({ to: ["carla.cobra"], title: "Comprobante de pago recibido", body: "Jesús · Plan 1", kind: "payment", sale_id: "S1", url: "/operations/sales/S1" });
  assert.equal(pushes.length, 2);
  assert.equal(r.pushed, 1);
  assert.deepEqual(store.forUser("carla.cobra").map(s => s.endpoint), ["https://push.example.com/phone"]);
  assert.equal(pushes[0].payload.url, "/operations/sales/S1");
});

test("rutas: llave pública, suscribirse, service worker y aviso dentro de la página", async t => {
  const env = setup();
  const app = express(); app.use(express.json());
  const settings = new OpsSettingsStore(path.join(env.dir, "st.json"), path.join(env.dir, "img.bin"));
  const sessions = new SessionStore(path.join(env.dir, "se.json"));
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://c", accountId: 1 } }, saleStore: env.saleStore, workflow: env.workflow, memories: { get: () => ({}) }, inspectorEvents: { async record() {} }, buffer: null, users: env.users, sessions, settings, audit: new OpsAuditStore(path.join(env.dir, "a.json")), notifier: env.notifier, push: env.store }));
  const server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/operations/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-ops-request": "1" }, body: JSON.stringify({ username: "carla.cobra", password: "clave-segura-123" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const h = { cookie, "content-type": "application/json", "x-ops-request": "1" };
  const key = await (await fetch(`${base}/operations/api/push/key`, { headers: h })).json();
  assert.equal(key.public_key, env.store.vapid().publicKey);
  const res = await fetch(`${base}/operations/api/push/subscribe`, { method: "POST", headers: h, body: JSON.stringify({ subscription: sub("https://fcm.googleapis.com/fcm/send/x") }) });
  assert.equal(res.status, 200);
  assert.equal(env.store.forUser("carla.cobra").length, 1);
  const bad = await fetch(`${base}/operations/api/push/subscribe`, { method: "POST", headers: h, body: JSON.stringify({ subscription: { endpoint: "http://evil" } }) });
  assert.equal(bad.status, 400);
  const sw = await fetch(`${base}/operations/sw.js`);
  assert.equal(sw.headers.get("service-worker-allowed"), "/operations");
  assert.match(await sw.text(), /showNotification/);
  assert.equal((await fetch(`${base}/operations/pwa/manifest.webmanifest`)).status, 200);
  assert.equal((await fetch(`${base}/operations/pwa/..%2Fapp.client.js`)).status, 404);

  // SSE: el aviso solo llega a la persona destinataria.
  const controller = new AbortController();
  const stream = await fetch(`${base}/operations/api/events`, { headers: { cookie }, signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read(); // connected
  await env.notifier.notify({ to: ["ana.captura"], title: "otra persona", kind: "new" });
  await env.notifier.notify({ to: ["carla.cobra"], title: "Comprobante de pago recibido", body: "Jesús", kind: "payment", sale_id: "S1" });
  const chunk = new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  assert.doesNotMatch(chunk, /otra persona/);
  assert.match(chunk, /"type":"notify".*Comprobante de pago recibido/);
});
