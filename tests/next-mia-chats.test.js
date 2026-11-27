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

// Chats de Mia (pedido 3-nov): todas las conversaciones de la IA y botón para que Captura intervenga.
test("Chats de Mia: lista con señales de riesgo; Captura interviene (asigna, nota, Mia se calla) y regresa a Mia", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-miachats-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "carla.captura", name: "Carla Captura", areas: ["captura"], password: "clave-segura-123", chatwoot_agent_id: 61 });
  users.create({ username: "pepe.captura", name: "Pepe Captura", areas: ["captura"], password: "clave-segura-123" });
  users.create({ username: "olga.obs", name: "Olga", areas: ["observador"], password: "clave-segura-123" });
  users.create({ username: "vale.valida", name: "Vale", areas: ["validacion"], password: "clave-segura-123" });
  users.create({ username: "sofi.super", name: "Sofi", areas: ["supervision"], password: "clave-segura-123" });
  users.create({ username: "cris.cobranza", name: "Cris", areas: ["cobranza"], password: "clave-segura-123" });
  users.create({ username: "ana.admin", name: "Ana", areas: ["admin"], password: "clave-segura-123" });
  // 12-nov: permiso "Chats de Mia"; con Atención a Clientes ve celulares, sin ella no.
  users.create({ username: "tono.atencion", name: "Toño", areas: ["atencion", "chats_mia"], password: "clave-segura-123" });
  users.create({ username: "rita.chats", name: "Rita", areas: ["chats_mia"], password: "clave-segura-123" });
  users.create({ username: "beto.atencion", name: "Beto", areas: ["atencion"], password: "clave-segura-123" });
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"));
  const now = Date.now();
  const iso = minAgo => new Date(now - minAgo * 60000).toISOString();
  await memories.merge(10, { nombre: "Rosa", sales_cycle: { stage: "explaining", recommended_plan: "plan_1", deferral: "no_money" } });
  await memories.merge(11, { nombre: "Luis", sales_cycle: { stage: "authorized", authorized: true, selected_plan: "plan_2" } });
  await memories.merge(12, { nombre: "Memo", sales_cycle: { stage: "exploring" } });
  await events.record(10, "ai_reply_sent", { customer_text: "Está muy caro", reply: "Entiendo…", decision_source: "price_objection" });
  await events.record(11, "ai_reply_sent", { customer_text: "Sí, iniciemos", reply: "¡Perfecto!", decision_source: "commitment:start" });
  await events.record(12, "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola!", decision_source: "progressive_opening" });

  const cw = { assigned: [], notes: [] };
  const chatwoot = {
    async assignConversation(id, agent) { cw.assigned.push([id, agent]); },
    async sendMessage(id, text, priv) { if (priv) cw.notes.push([id, text]); else (cw.sent ||= []).push([id, text]); },
    async getConversation(id) { return { id, meta: { sender: { phone_number: id === 12 ? "+5215511112222" : null } } }; },
    async getAllMessages() { return { payload: [{ id: 1, message_type: 0, content: "Está muy caro", created_at: Math.floor(now / 1000) }] }; },
    async getMessages() { return { payload: [] }; },
  };
  const miaConsole = new MiaConsole({ config: { ai: {} }, memories, inspectorEvents: events, chatwoot });
  const audit = new OpsAuditStore(path.join(dir, "a.json"));
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories, inspectorEvents: events, buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit, chatwoot, miaConsole }));
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
  const sofi = await as("sofi.super"); const ana = await as("ana.admin");
  const carla = await as("carla.captura"); const pepe = await as("pepe.captura"); const olga = await as("olga.obs"); const vale = await as("vale.valida");

  // Menú: Captura y Observador ven "Chats de Mia"; Validación no.
  assert.ok((await carla("/operations/api/me")).body.areas.some(a => a.key === "chats"));
  assert.equal((await carla("/operations/api/me")).body.can.intervene, true);
  assert.ok((await olga("/operations/api/me")).body.areas.some(a => a.key === "chats"));
  assert.equal((await olga("/operations/api/me")).body.can.intervene, false);
  assert.ok(!(await vale("/operations/api/me")).body.areas.some(a => a.key === "chats"));
  assert.equal((await vale("/operations/api/mia-chats")).status, 403);

  const all = await carla("/operations/api/mia-chats?filter=all");
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);
  const rosa = all.body.items.find(i => i.id === 10);
  assert.deepEqual(rosa.risks.map(r => r.key).sort(), ["deferred", "price"]);
  assert.equal(rosa.hot, true);
  const risk = await carla("/operations/api/mia-chats?filter=risk");
  assert.deepEqual(risk.body.items.map(i => i.id), [10], "Luis ya aceptó y Memo va bien");
  assert.equal(risk.body.counts.authorized, 1);
  assert.equal((await carla("/operations/api/mia-chats?filter=all&q=memo")).body.items[0].id, 12);
  const chat = await olga("/operations/api/mia-chats/10/conversation");
  assert.equal(chat.status, 200);
  assert.equal(chat.body.items[0].text, "Está muy caro");

  // Observador no interviene; sin agente de Chatwoot no se puede intervenir.
  assert.equal((await olga("/operations/api/mia-chats/10/intervene", {})).status, 403);
  const noAgent = await pepe("/operations/api/mia-chats/10/intervene", {});
  assert.equal(noAgent.status, 400);
  assert.match(noAgent.body.error, /agente de Chatwoot/);

  const done = await carla("/operations/api/mia-chats/10/intervene", { note: "Le explico el precio" });
  assert.equal(done.status, 200);
  assert.match(done.body.chatwoot_url, /conversations\/10$/);
  assert.deepEqual(cw.assigned.at(-1), [10, 61]);
  assert.match(cw.notes.at(-1)[1], /^CAPTURA INTERVINO ESTE CHAT\nResponsable: Carla Captura/);
  assert.equal(memories.get(10).capture_intervention.active, true);
  assert.ok(events.get(10).some(e => e.type === "capture_intervention"));
  assert.ok(audit.list().some(e => e.type === "mia.intervene" && e.details.conversation_id === 10));
  assert.equal((await carla("/operations/api/mia-chats/10/intervene", {})).status, 400, "no dos veces");
  const intervened = await carla("/operations/api/mia-chats?filter=intervened");
  assert.deepEqual(intervened.body.items.map(i => i.id), [10]);
  assert.equal(intervened.body.items[0].intervention.username, "carla.captura");

  // 13-nov: el expediente de Captura sabe que el chat está intervenido (para mostrar "Regresar a Mia").
  const sale10 = new SaleWorkflowEngine(saleStore).openAuthorizedSale({ conversation_id: 10, customer: { nombre: "Lucía" }, sale: { plan: "plan_1", authorized: true } });
  assert.equal((await carla(`/operations/api/sales/${sale10.sale_id}`)).body.mia.intervention.username, "carla.captura");
  // Solo quien intervino (o Supervisión) lo regresa a Mia.
  assert.equal((await pepe("/operations/api/mia-chats/10/release", {})).status, 400);
  const back = await carla("/operations/api/mia-chats/10/release", { note: "Ya quiere seguir" });
  assert.equal((await carla(`/operations/api/sales/${sale10.sale_id}`)).body.mia.intervention, null);
  assert.equal(back.status, 200);
  assert.deepEqual(cw.assigned.at(-1), [10, 53]);
  assert.match(cw.notes.at(-1)[1], /^CAPTURA REGRESÓ EL CHAT A MIA/);
  assert.equal(memories.get(10).capture_intervention.active, false);

  // Celulares (pedido 4-nov): solo Supervisión y Admin; los que faltan se buscan en Chatwoot y se guardan.
  await memories.merge(10, { contact_phone: "+5215599998888" });
  const supList = await sofi("/operations/api/mia-chats?filter=all");
  assert.equal(supList.body.items.find(i => i.id === 10).phone, "+5215599998888");
  assert.equal(supList.body.items.find(i => i.id === 12).phone, "+5215511112222", "se completó desde Chatwoot");
  assert.equal(memories.get(12).contact_phone, "+5215511112222");
  assert.equal((await ana("/operations/api/mia-chats?filter=all")).body.items.find(i => i.id === 10).phone, "+5215599998888");
  assert.deepEqual((await sofi("/operations/api/mia-chats?filter=all&q=9999 8888".replace(" ", ""))).body.items.map(i => i.id), [10], "Supervisión busca por celular");
  const cris = await as("cris.cobranza");
  assert.ok((await cris("/operations/api/me")).body.areas.some(a => a.key === "chats"), "Cobranza ve Chats de Mia");
  assert.equal((await cris("/operations/api/me")).body.can.intervene, false);
  assert.equal((await cris("/operations/api/mia-chats?filter=all")).body.items.find(i => i.id === 10).phone, "+5215599998888", "Cobranza ve celulares");
  assert.equal((await cris("/operations/api/mia-chats/10/intervene", {})).status, 403, "Cobranza no interviene");
  // 12-nov: "Intervenir solo con mensaje": llega al cliente, Mia se queda con el chat y lo toma como su última respuesta.
  const fix = "Una disculpa, te corrijo: el Plan 1 sí incluye a tus hijos menores de 16 años.";
  assert.equal((await carla("/operations/api/mia-chats/12/message", { text: fix })).status, 200);
  assert.deepEqual(cw.sent.at(-1), [12, fix]);
  assert.equal(memories.get(12).ultima_respuesta_agente, fix);
  assert.equal(memories.get(12).team_messages.at(-1).by, "Carla Captura");
  assert.ok(!memories.get(12).capture_intervention?.active, "no le quita el chat a Mia");
  assert.equal((await carla("/operations/api/mia-chats/12/message", { text: "  " })).status, 400);
  assert.equal((await olga("/operations/api/mia-chats/12/message", { text: fix })).status, 403, "Observador no manda mensajes");
  const tono = await as("tono.atencion"), rita = await as("rita.chats"), beto = await as("beto.atencion");
  assert.ok((await tono("/operations/api/me")).body.areas.some(a => a.key === "chats"), "con el permiso ve Chats de Mia");
  assert.ok(!(await tono("/operations/api/me")).body.areas.some(a => a.key === "chats_mia"), "el permiso no es una pestaña aparte");
  assert.equal((await tono("/operations/api/me")).body.can.mia_phones, true);
  assert.equal((await tono("/operations/api/mia-chats?filter=all")).body.items.find(i => i.id === 10).phone, "+5215599998888", "Atención a Clientes con el permiso ve celulares");
  assert.equal((await tono("/operations/api/mia-chats/10/intervene", {})).status, 403, "el permiso no da intervenir");
  assert.equal((await tono("/operations/api/me")).body.can.message, true, "Atención a Clientes ve 'Intervenir solo con mensaje'");
  assert.equal((await tono("/operations/api/mia-chats/12/message", { text: "Hola, te escribe el equipo de Atención a Clientes." })).status, 200);
  assert.equal((await rita("/operations/api/mia-chats/12/message", { text: "hola" })).status, 403, "solo el permiso de chats no manda mensajes");
  assert.ok((await rita("/operations/api/mia-chats?filter=all")).body.items.every(i => !("phone" in i)), "solo el permiso: sin celulares");
  assert.equal((await beto("/operations/api/mia-chats?filter=all")).status, 403, "Atención a Clientes sin el permiso no ve Chats de Mia");
  for (const who of [carla, olga]) {
    const list = await who("/operations/api/mia-chats?filter=all");
    assert.ok(list.body.items.every(i => !("phone" in i)), "Captura y Observador no ven celulares");
    assert.equal((await who("/operations/api/mia-chats?filter=all&q=99998888")).body.items.length, 0, "ni pueden buscar por celular");
  }
});
