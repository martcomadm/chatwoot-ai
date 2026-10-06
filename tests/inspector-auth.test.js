import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createRouter } from "../src/routes.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function startApp() {
  const config = {
    inspector: { token: "insp-token", adminToken: "admin-token" },
    webhookSecret: "",
    ai: {}, handoff: {}, storage: {}, chatwoot: {},
  };
  const app = express();
  app.use(express.json());
  app.use(createRouter({ config, memories: { get: id => ({ id }) }, buffer: {}, inspectorEvents: {}, handoffRotation: {}, operationsConfig: {}, chatwoot: {} }));
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("admin-check valida solo el token administrador", async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const url = `${base}/inspector/api/control/admin-check`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-inspector-admin-token": "otro" } })).status, 401);
  assert.equal((await fetch(url, { headers: { "x-inspector-token": "insp-token" } })).status, 401);
  const ok = await fetch(url, { headers: { "x-inspector-admin-token": "admin-token" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
});

test("el token del Inspector ya no se acepta por ?token= en la URL", async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  assert.equal((await fetch(`${base}/memory/7?token=insp-token`)).status, 401);
  assert.equal((await fetch(`${base}/memory/7`, { headers: { "x-inspector-token": "insp-token" } })).status, 200);
  assert.equal((await fetch(`${base}/memory/7`, { headers: { "x-inspector-token": "insp-tokenX" } })).status, 401);
});

test("/health reporta la versión de package.json", async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  assert.equal((await (await fetch(`${base}/health`)).json()).version, pkg.version);
});
