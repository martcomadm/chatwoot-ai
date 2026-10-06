import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createOperationsRouter } from "../src/operations/operations-router.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";
import { UserStore } from "../src/operations/access/user-store.js";
import { SessionStore } from "../src/operations/access/session-store.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { OpsAuditStore } from "../src/operations/access/audit-store.js";

const OPS_TOKEN = "ops-token-de-prueba";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "martcom-ops-access-"));
  const saleStore = new SaleStore(path.join(dir, "sales.json"));
  const workflow = new SaleWorkflowEngine(saleStore);
  const users = new UserStore(path.join(dir, "ops-users.json"));
  const sessions = new SessionStore(path.join(dir, "ops-sessions.json"));
  const settings = new OpsSettingsStore(path.join(dir, "ops-settings.json"), path.join(dir, "ops-accounts-image.bin"));
  const audit = new OpsAuditStore(path.join(dir, "ops-audit.json"));
  const config = { appEnv: "next", operations: { token: OPS_TOKEN }, chatwoot: { baseUrl: "https://chat.test", accountId: 1 } };
  const app = express();
  app.use(express.json({ limit: "16mb" }));
  app.use(createOperationsRouter({ config, saleStore, workflow, memories: { get: () => ({}), async clear() {} }, inspectorEvents: { async record() {} }, buffer: null, users, sessions, settings, audit }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, server, base, saleStore, workflow, users, sessions, settings, audit };
}

// Cliente con su propia cookie, como un navegador.
function client(base) {
  let cookie = "";
  return async function call(pathname, { method = "GET", body, headers = {}, csrf = true } = {}) {
    const response = await fetch(base + pathname, {
      method,
      headers: { "content-type": "application/json", ...(csrf ? { "x-ops-request": "1" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    let json = null;
    try { json = await response.json(); } catch {}
    return { status: response.status, body: json, setCookie };
  };
}

function seedSale(workflow, saleStore, conversationId, { toQueue = "capture" } = {}) {
  const sale = workflow.openAuthorizedSale({ conversation_id: conversationId, customer: { nombre: `Cliente ${conversationId}`, curp: "XEXX010101HNEXXXA4", nss: "12345678901" }, sale: { plan: "plan_1", precio: 1100, authorized: true } });
  if (toQueue === "capture") return saleStore.get(sale.sale_id);
  workflow.completeCapture(sale.sale_id);
  if (toQueue === "validation") return saleStore.get(sale.sale_id);
  for (const key of ["datos", "alta", "documentos", "revision_final"]) workflow.setValidationCheck(sale.sale_id, key, true, {});
  if (toQueue === "validity") return saleStore.get(sale.sale_id);
  workflow.confirmValidity(sale.sale_id, { document_name: "vigencia.pdf" });
  return saleStore.get(sale.sale_id);
}

async function withTeam(t) {
  const env = await setup();
  t.after(() => env.server.close());
  const admin = client(env.base);
  const boot = await admin("/operations/api/auth/bootstrap", { method: "POST", body: { token: OPS_TOKEN, username: "axel.admin", name: "Axel Admin", password: "admin-clave-123" } });
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  const people = [
    ["ana.captura", "Ana Captura", ["captura"]],
    ["vale.valida", "Vale Validación", ["validacion"]],
    ["sergio.super", "Sergio Supervisión", ["supervision"]],
    ["carla.cobra", "Carla Cobranza", ["cobranza"]],
  ];
  const sessions = {};
  for (const [username, name, areas] of people) {
    const created = await admin("/operations/api/admin/users", { method: "POST", body: { username, name, areas, password: "clave-segura-123" } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const c = client(env.base);
    const login = await c("/operations/api/auth/login", { method: "POST", body: { username, password: "clave-segura-123" } });
    assert.equal(login.status, 200);
    sessions[username] = c;
  }
  return { ...env, admin, ...sessions };
}

test("primer arranque: el primer administrador solo se crea con OPERATIONS_TOKEN", async t => {
  const env = await setup();
  t.after(() => env.server.close());
  const c = client(env.base);
  assert.deepEqual((await c("/operations/api/auth/status")).body, { needs_setup: true, setup_available: true, user: null });
  assert.equal((await c("/operations/api/auth/bootstrap", { method: "POST", body: { token: "otro", username: "x.admin", name: "X", password: "clave-segura-123" } })).status, 401);
  assert.equal((await c("/operations/api/auth/bootstrap", { method: "POST", csrf: false, body: { token: OPS_TOKEN, username: "x.admin", name: "X", password: "clave-segura-123" } })).status, 403);
  const ok = await c("/operations/api/auth/bootstrap", { method: "POST", body: { token: OPS_TOKEN, username: "x.admin", name: "X Admin", password: "clave-segura-123" } });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /martcom_ops=.+HttpOnly; SameSite=Strict/);
  assert.deepEqual(ok.body.user.areas, ["admin"]);
  assert.equal((await c("/operations/api/me")).body.user.username, "x.admin");
  const again = await client(env.base)("/operations/api/auth/bootstrap", { method: "POST", body: { token: OPS_TOKEN, username: "y.admin", name: "Y", password: "clave-segura-123" } });
  assert.equal(again.status, 409);
  const stored = fs.readFileSync(path.join(env.dir, "ops-users.json"), "utf8");
  assert.doesNotMatch(stored, /clave-segura-123/, "la contraseña nunca se guarda en texto plano");
});

test("sin sesión no se ve nada; con contraseña equivocada se bloquea tras 5 intentos", async t => {
  const { base, admin } = await withTeam(t);
  const anon = client(base);
  assert.equal((await anon("/operations/api/sales")).status, 401);
  assert.equal((await anon("/operations/api/me")).status, 401);
  for (let i = 0; i < 5; i += 1) assert.equal((await anon("/operations/api/auth/login", { method: "POST", body: { username: "ana.captura", password: "mala" } })).status, 401);
  assert.equal((await anon("/operations/api/auth/login", { method: "POST", body: { username: "ana.captura", password: "clave-segura-123" } })).status, 429);
  assert.equal((await admin("/operations/api/me")).status, 200);
});

test("cada área solo ve y opera su propia cola", async t => {
  const team = await withTeam(t);
  const captureSale = seedSale(team.workflow, team.saleStore, 101, { toQueue: "capture" });
  const validationSale = seedSale(team.workflow, team.saleStore, 102, { toQueue: "validation" });

  const anaList = await team["ana.captura"]("/operations/api/sales");
  assert.deepEqual(anaList.body.items.map(sale => sale.sale_id), [captureSale.sale_id]);
  assert.equal(anaList.body.items[0].events, undefined, "la lista no trae el historial completo");
  assert.equal((await team["ana.captura"](`/operations/api/sales/${validationSale.sale_id}`)).status, 403);
  assert.equal((await team["ana.captura"](`/operations/api/sales/${captureSale.sale_id}/validation/check`, { method: "POST", body: { key: "datos", checked: true } })).status, 403);
  assert.equal((await team["vale.valida"](`/operations/api/sales/${captureSale.sale_id}/capture/start`, { method: "POST" })).status, 403);

  const valeList = await team["vale.valida"]("/operations/api/sales");
  assert.deepEqual(valeList.body.items.map(sale => sale.sale_id), [validationSale.sale_id]);

  const supList = await team["sergio.super"]("/operations/api/sales");
  assert.equal(supList.body.items.length, 2, "Supervisión ve todas las colas");
  assert.equal((await team["sergio.super"](`/operations/api/sales/${captureSale.sale_id}/capture/start`, { method: "POST" })).status, 403, "Supervisión no ejecuta acciones de área");
});

test("las acciones quedan a nombre de la persona en sesión, no de lo que mande el navegador", async t => {
  const team = await withTeam(t);
  const sale = seedSale(team.workflow, team.saleStore, 201);
  const started = await team["ana.captura"](`/operations/api/sales/${sale.sale_id}/capture/start`, { method: "POST", body: { name: "Otra Persona", by: "Alguien" } });
  assert.equal(started.status, 200);
  assert.equal(started.body.sale.assignee.username, "ana.captura");
  const completed = await team["ana.captura"](`/operations/api/sales/${sale.sale_id}/capture/complete`, { method: "POST", body: { by: "Falso" } });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.sale.queue, "validation");
  const events = team.saleStore.get(sale.sale_id).events;
  const done = events.find(event => event.type === "capture.completed");
  assert.deepEqual(done.actor, { username: "ana.captura", name: "Ana Captura", via: "session" });
  assert.equal(done.queue, "validation");
  assert.equal(team.saleStore.get(sale.sale_id).assignee, null, "al cambiar de área se libera el responsable");
});

test("escrituras con cookie exigen la cabecera de Operations (protección CSRF)", async t => {
  const team = await withTeam(t);
  const sale = seedSale(team.workflow, team.saleStore, 301);
  const res = await team["ana.captura"](`/operations/api/sales/${sale.sale_id}/capture/start`, { method: "POST", csrf: false });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "csrf");
});

test("el token de entorno sigue funcionando como acceso de administrador para scripts", async t => {
  const team = await withTeam(t);
  const sale = seedSale(team.workflow, team.saleStore, 401);
  const anon = client(team.base);
  const res = await anon(`/operations/api/sales/${sale.sale_id}/capture/start`, { method: "POST", csrf: false, headers: { "x-operations-token": OPS_TOKEN } });
  assert.equal(res.status, 200);
  const event = team.saleStore.get(sale.sale_id).events.find(item => item.type === "capture.started");
  assert.equal(event.actor.username, "token-operaciones");
  assert.equal((await anon("/operations/api/sales", { headers: { "x-operations-token": "malo" } })).status, 401);
});

test("Supervisión regresa, asigna y cancela expedientes", async t => {
  const team = await withTeam(t);
  const sale = seedSale(team.workflow, team.saleStore, 501, { toQueue: "validity" });
  const sup = team["sergio.super"];

  assert.equal((await sup(`/operations/api/sales/${sale.sale_id}/supervision/return`, { method: "POST", body: { target: "capture" } })).status, 400, "exige motivo");
  const returned = await sup(`/operations/api/sales/${sale.sale_id}/supervision/return`, { method: "POST", body: { target: "capture", reason: "CURP con error" } });
  assert.equal(returned.status, 200);
  assert.equal(returned.body.sale.queue, "capture");
  assert.equal(returned.body.sale.status, "waiting_capture");
  assert.equal(returned.body.sale.validation.approved, false, "la validación se reinicia");

  const wrong = await sup(`/operations/api/sales/${sale.sale_id}/supervision/assign`, { method: "POST", body: { username: "vale.valida" } });
  assert.equal(wrong.status, 400, "no se asigna a alguien de otra área");
  const assigned = await sup(`/operations/api/sales/${sale.sale_id}/supervision/assign`, { method: "POST", body: { username: "ana.captura" } });
  assert.equal(assigned.body.sale.assignee.username, "ana.captura");
  const anaMine = await team["ana.captura"]("/operations/api/sales?assignee=me");
  assert.deepEqual(anaMine.body.items.map(item => item.sale_id), [sale.sale_id]);

  const cancelled = await sup(`/operations/api/sales/${sale.sale_id}/supervision/cancel`, { method: "POST", body: { reason: "Cliente desistió" } });
  assert.equal(cancelled.body.sale.queue, "cancelled");
  assert.equal((await team["ana.captura"]("/operations/api/sales")).body.items.length, 0, "un cancelado sale de la cola de Captura");
  const reactivated = await sup(`/operations/api/sales/${sale.sale_id}/supervision/return`, { method: "POST", body: { target: "capture", reason: "Cliente regresó" } });
  assert.equal(reactivated.body.sale.queue, "capture");
  assert.equal((await team["ana.captura"](`/operations/api/sales/${sale.sale_id}/supervision/cancel`, { method: "POST", body: { reason: "x" } })).status, 403);
});

test("tomar y soltar expedientes de la propia cola", async t => {
  const team = await withTeam(t);
  const sale = seedSale(team.workflow, team.saleStore, 601);
  const ana = team["ana.captura"];
  assert.equal((await ana(`/operations/api/sales/${sale.sale_id}/take`, { method: "POST" })).body.sale.assignee.name, "Ana Captura");
  const otherCapturist = await team.admin("/operations/api/admin/users", { method: "POST", body: { username: "luis.captura", name: "Luis", areas: ["captura"], password: "clave-segura-123" } });
  assert.equal(otherCapturist.status, 200);
  const luis = client(team.base);
  await luis("/operations/api/auth/login", { method: "POST", body: { username: "luis.captura", password: "clave-segura-123" } });
  assert.equal((await luis(`/operations/api/sales/${sale.sale_id}/take`, { method: "POST" })).status, 409, "no se arrebata un expediente tomado");
  assert.equal((await ana(`/operations/api/sales/${sale.sale_id}/release`, { method: "POST" })).body.sale.assignee, null);
});

test("tablero de Supervisión: flujo, atrasos y desempeño por persona", async t => {
  const team = await withTeam(t);
  const late = seedSale(team.workflow, team.saleStore, 701);
  const current = team.saleStore.get(late.sale_id);
  team.saleStore.update(late.sale_id, { ...current, queue_entered_at: new Date(Date.now() - 6 * 3600000).toISOString() }, "test.aged", {});
  const done = seedSale(team.workflow, team.saleStore, 702);
  await team["ana.captura"](`/operations/api/sales/${done.sale_id}/capture/complete`, { method: "POST" });

  assert.equal((await team["ana.captura"]("/operations/api/supervision/overview")).status, 403);
  const overview = await team["sergio.super"]("/operations/api/supervision/overview");
  assert.equal(overview.status, 200);
  const capture = overview.body.flow.find(step => step.queue === "capture");
  assert.equal(capture.total, 1);
  assert.equal(capture.overdue, 1, "6 h en Captura supera el objetivo de 4 h");
  assert.equal(overview.body.alerts[0].sale_id, late.sale_id);
  const ana = overview.body.performance.find(person => person.username === "ana.captura");
  assert.equal(ana.total, 1);
  assert.equal(ana.by_event["capture.completed"], 1);
  assert.ok(ana.avg_hours !== null);
});

test("Admin: desactivar a alguien cierra su sesión y no puede quedar sin administradores", async t => {
  const team = await withTeam(t);
  assert.equal((await team["ana.captura"]("/operations/api/admin/users")).status, 403);
  const off = await team.admin("/operations/api/admin/users/ana.captura", { method: "PATCH", body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal((await team["ana.captura"]("/operations/api/me")).status, 401);
  const lastAdmin = await team.admin("/operations/api/admin/users/axel.admin", { method: "PATCH", body: { areas: ["captura"] } });
  assert.equal(lastAdmin.status, 400);
  assert.match(lastAdmin.body.error, /al menos un administrador/);
  const audit = await team.admin("/operations/api/admin/audit");
  assert.ok(audit.body.items.some(row => row.type === "user.updated" && row.actor?.username === "axel.admin"));
});

test("cambio de contraseña propia y restablecimiento por Admin", async t => {
  const team = await withTeam(t);
  const ana = team["ana.captura"];
  assert.equal((await ana("/operations/api/me/password", { method: "POST", body: { current: "mala", next: "otra-clave-123" } })).status, 401);
  assert.equal((await ana("/operations/api/me/password", { method: "POST", body: { current: "clave-segura-123", next: "corta" } })).status, 400);
  assert.equal((await ana("/operations/api/me/password", { method: "POST", body: { current: "clave-segura-123", next: "otra-clave-123" } })).status, 200);
  assert.equal((await ana("/operations/api/me")).status, 200, "la sesión actual sigue activa");
  await team.admin("/operations/api/admin/users/ana.captura/password", { method: "POST", body: { password: "temporal-12345" } });
  assert.equal((await ana("/operations/api/me")).status, 401, "el restablecimiento cierra sus sesiones");
});

test("Admin configura tiempos, mensajes e imagen de cuentas que Cobranza usa por defecto", async t => {
  const team = await withTeam(t);
  const saved = await team.admin("/operations/api/admin/settings", { method: "PUT", body: { alert_hours: { capture: 2 }, customer_messages: { "payment.requested": "Paga {monto} hoy, por favor." } } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.alert_hours.capture, 2);
  assert.equal(saved.body.settings.alert_hours.validity, 48);
  assert.equal(team.settings.customerMessages()["payment.requested"], "Paga {monto} hoy, por favor.");
  assert.equal((await team.admin("/operations/api/admin/settings", { method: "PUT", body: { alert_hours: { capture: 0 } } })).status, 400);

  const sale = seedSale(team.workflow, team.saleStore, 801, { toQueue: "payment" });
  const noImage = await team["carla.cobra"](`/operations/api/sales/${sale.sale_id}/payment/request`, { method: "POST", body: {} });
  assert.equal(noImage.status, 400);
  assert.match(noImage.body.error, /imagen de cuentas/);
  assert.equal((await team.admin("/operations/api/admin/settings/accounts-image", { method: "PUT", body: { name: "cuentas.png", content_type: "image/png", base64: PNG } })).status, 200);
  const requested = await team["carla.cobra"](`/operations/api/sales/${sale.sale_id}/payment/request`, { method: "POST", body: {} });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.sale.payment.accounts_image_name, "cuentas.png");
  assert.equal(requested.body.sale.payment.accounts_image_base64, null, "la API nunca devuelve el base64");
  assert.equal(team.saleStore.get(sale.sale_id).payment.accounts_image_base64, PNG, "pero queda guardado para que Mia lo envíe");
});

test("el reinicio LAB es solo para Admin", async t => {
  const team = await withTeam(t);
  seedSale(team.workflow, team.saleStore, 901);
  assert.equal((await team["sergio.super"]("/operations/api/lab/reset-conversation", { method: "POST", body: { conversation_id: 901, confirm: "RESET 901" } })).status, 403);
  const reset = await team.admin("/operations/api/lab/reset-conversation", { method: "POST", body: { conversation_id: 901, confirm: "RESET 901" } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.removed_sale_ids.length, 1);
});

test("cerrar sesión invalida la cookie", async t => {
  const team = await withTeam(t);
  const ana = team["ana.captura"];
  await ana("/operations/api/auth/logout", { method: "POST" });
  assert.equal((await ana("/operations/api/me")).status, 401);
});

test("la página de Operations se sirve y su script es JavaScript válido", async t => {
  const team = await withTeam(t);
  const html = await (await fetch(`${team.base}/operations`)).text();
  assert.match(html, /<title>MARTCOM Operations<\/title>/);
  assert.doesNotMatch(html, /__APP_(CSS|JS)__/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /x-ops-request/);
  const detail = await fetch(`${team.base}/operations/sales/MART-1`);
  assert.equal(detail.status, 200);
});
