import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRouter } from "../src/routes.js";

function startApp(config) {
  const cleared = [];
  const memories = {
    get: id => ({ id, nombre: "Cliente Prueba", curp_valor: "XEXX010101HNEXXXA4", nss_valor: "12345678901" }),
    async clear(id) { cleared.push(id); },
  };
  const app = express();
  app.use(express.json());
  app.use(createRouter({ config, memories, buffer: {}, inspectorEvents: {}, handoffRotation: {}, operationsConfig: {}, chatwoot: {} }));
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, cleared }));
  });
}

const baseConfig = {
  inspector: { token: "insp-token", adminToken: "admin-token" },
  webhookSecret: "",
  ai: {}, handoff: {}, storage: {}, chatwoot: {},
};

test("GET /memory exige token del Inspector y no expone CURP/NSS sin él", async t => {
  const { server, base } = await startApp(baseConfig);
  t.after(() => server.close());
  const anonymous = await fetch(`${base}/memory/77`);
  assert.equal(anonymous.status, 401);
  assert.doesNotMatch(await anonymous.text(), /XEXX010101|12345678901/);
  const wrong = await fetch(`${base}/memory/77`, { headers: { "x-inspector-token": "otro" } });
  assert.equal(wrong.status, 401);
  const ok = await fetch(`${base}/memory/77`, { headers: { "x-inspector-token": "insp-token" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).nss_valor, "12345678901");
});

test("GET /memory queda cerrado si no hay token de Inspector configurado", async t => {
  const { server, base } = await startApp({ ...baseConfig, inspector: { token: "", adminToken: "" } });
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/memory/77`)).status, 401);
});

test("DELETE /memory ya no queda abierto cuando falta WEBHOOK_SECRET", async t => {
  const { server, base, cleared } = await startApp(baseConfig);
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/memory/77`, { method: "DELETE" })).status, 401);
  assert.deepEqual(cleared, []);
  const admin = await fetch(`${base}/memory/77`, { method: "DELETE", headers: { "x-inspector-admin-token": "admin-token" } });
  assert.equal(admin.status, 200);
  assert.deepEqual(cleared, [77]);
});

test("DELETE /memory acepta el WEBHOOK_SECRET configurado", async t => {
  const { server, base, cleared } = await startApp({ ...baseConfig, webhookSecret: "s3cret" });
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/memory/5?secret=mal`, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(`${base}/memory/5?secret=s3cret`, { method: "DELETE" })).status, 200);
  assert.deepEqual(cleared, [5]);
});
