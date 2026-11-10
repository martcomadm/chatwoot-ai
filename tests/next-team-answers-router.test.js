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

import { TeamAnswerStore } from "../src/knowledge/team-answers.js";
import { LearningInbox } from "../src/knowledge/learning-inbox.js";
import { ReplyFeedbackStore } from "../src/knowledge/reply-feedback.js";

// Respuestas de Mia (4-nov): solo Supervisión y Admin; convertir una pregunta que Mia no supo.
test("Respuestas de Mia: permisos, alta/edición/borrado y convertir lo que contestó una persona", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-answers-"));
  const users = new UserStore(path.join(dir, "u.json"));
  users.create({ username: "sofi.super", name: "Sofi", areas: ["supervision"], password: "clave-segura-123" });
  users.create({ username: "ana.admin", name: "Ana", areas: ["admin"], password: "clave-segura-123" });
  users.create({ username: "carla.captura", name: "Carla", areas: ["captura"], password: "clave-segura-123" });
  users.create({ username: "quique.calidad", name: "Quique", areas: ["calidad"], password: "clave-segura-123" });
  const memories = new MemoryStore(path.join(dir, "m.json"));
  await memories.merge(7, { nombre: "Rosa", handoff: { status: "completed" } });
  const chatwoot = { async getAllMessages() { return { payload: [
    { id: 1, message_type: 0, content: "¿Tienen oficina en Guadalajara para ir?", created_at: 1 },
    { id: 2, message_type: 1, content: "Todo el trámite es en línea por WhatsApp, no necesitas ir a ninguna oficina.", sender: { id: 62, type: "user", name: "Erika" }, created_at: 2 },
    { id: 3, message_type: 0, content: "¿Puedo meter a mi mamá?", created_at: 3 },
    { id: 4, message_type: 1, content: "¿Me compartes tu nombre completo?", sender: { id: 53, type: "user" }, created_at: 4 },
  ] }; } };
  const replyFeedback = new ReplyFeedbackStore(path.join(dir, "fb.json"));
  const teamAnswers = new TeamAnswerStore(path.join(dir, "ta.json"));
  const learningInbox = new LearningInbox({ file: path.join(dir, "li.json"), memories, chatwoot, selfSenders: { isOwn: m => Number(m.sender?.id) === 53 } });
  const audit = new OpsAuditStore(path.join(dir, "a.json"));
  const saleStore = new SaleStore(path.join(dir, "s.json"));
  const app = express(); app.use(express.json());
  app.use(createOperationsRouter({ config: { appEnv: "next", operations: { token: "t" }, chatwoot: { baseUrl: "https://chat.test", accountId: 1, agentId: 53 } }, saleStore, workflow: new SaleWorkflowEngine(saleStore), memories, inspectorEvents: new InspectorEventStore(path.join(dir, "e.json")), buffer: null, users, sessions: new SessionStore(path.join(dir, "se.json")), settings: new OpsSettingsStore(path.join(dir, "st.json"), path.join(dir, "img.bin")), audit, chatwoot, teamAnswers, learningInbox, replyFeedback, miaConsole: null }));
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

  const sofi = await as("sofi.super"); const ana = await as("ana.admin"); const carla = await as("carla.captura");
  assert.ok((await sofi("/operations/api/me")).body.areas.some(a => a.key === "respuestas"));
  assert.ok((await ana("/operations/api/me")).body.areas.some(a => a.key === "respuestas"));
  assert.ok(!(await carla("/operations/api/me")).body.areas.some(a => a.key === "respuestas"));
  // 10-nov: "Calidad de Mia" solo ve Chats de Mia y Respuestas de Mia; califica y enseña, no interviene ni ve
  // celulares, expedientes ni el interruptor de la reactivación.
  const quique = await as("quique.calidad");
  const qme = (await quique("/operations/api/me")).body;
  assert.deepEqual(qme.areas.map(a => a.key), ["chats", "respuestas"]);
  assert.equal(qme.can.intervene, false);
  assert.equal(qme.can.mia_phones, false);
  assert.deepEqual(qme.visible_queues, []);
  assert.equal((await quique("/operations/api/mia-chats")).status, 200);
  assert.equal((await quique("/operations/api/mia-answers")).status, 200);
  assert.equal((await quique("/operations/api/mia-chats/7/intervene", {})).status, 403);
  assert.equal((await quique("/operations/api/reactivation", { enabled: true })).status, 403);
  assert.equal((await quique("/operations/api/admin/users")).status, 403);
  assert.equal((await carla("/operations/api/mia-answers")).status, 403);
  assert.equal((await carla("/operations/api/mia-answers", { topic: "x", answer: "y" })).status, 403);

  const created = await sofi("/operations/api/mia-answers", { topic: "Pago con tarjeta", answer: "Por ahora el pago es por transferencia, depósito u OXXO.", phrases: "pagar con tarjeta" });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.item.phrases, ["pagar con tarjeta"]);
  assert.equal(created.body.item.created_by, "Sofi");
  assert.equal((await sofi("/operations/api/mia-answers", { topic: "", answer: "" })).status, 400);
  const edited = await ana(`/operations/api/mia-answers/${created.body.item.id}`, { answer: "El pago es por transferencia, depósito u OXXO; no aceptamos tarjeta.", active: false });
  assert.equal(edited.body.item.active, false);
  assert.equal(edited.body.item.updated_by, "Ana");
  const list = await sofi("/operations/api/mia-answers");
  assert.equal(list.body.items.length, 1);
  assert.ok(list.body.fixed.some(r => /Embarazo/.test(r)), "muestra las reglas fijas confirmadas");

  assert.deepEqual((await sofi("/operations/api/mia-learning/scan", {})).body, { ok: true, added: 1 });
  const learn = await sofi("/operations/api/mia-learning");
  assert.equal(learn.body.items[0].by, "Erika");
  const conv = await sofi(`/operations/api/mia-learning/${encodeURIComponent(learn.body.items[0].id)}/convert`, { topic: "¿Tienen oficina?", answer: learn.body.items[0].answer, phrases: "oficina en, tienen oficina" });
  assert.equal(conv.status, 200);
  assert.equal(conv.body.item.source, "learned");
  assert.equal(conv.body.item.learned_from.conversation_id, 7);
  assert.equal(teamAnswers.match("¿tienen oficina en Monterrey?").id, conv.body.item.id, "Mia ya lo usa");
  assert.equal((await sofi("/operations/api/mia-learning")).body.items.length, 0);
  assert.equal((await sofi(`/operations/api/mia-answers/${created.body.item.id}/delete`, {})).status, 200);
  assert.ok(audit.list().some(e => e.type === "mia.answer.learned"));

  // Calificar (4-nov): Captura califica mensajes de Mia; Supervisión convierte la corrección.
  assert.equal((await carla("/operations/api/mia-chats/7/rate", { message_id: "2", rating: "up" })).status, 400, "un mensaje de una persona no se califica");
  assert.equal((await carla("/operations/api/mia-chats/7/rate", { message_id: "4", rating: "down", correction: "no" })).status, 400);
  const rated = await carla("/operations/api/mia-chats/7/rate", { message_id: "4", rating: "down", correction: "Sí, tu mamá puede quedar como beneficiaria conforme a las reglas del IMSS." });
  assert.equal(rated.status, 200);
  assert.equal(rated.body.item.customer_text, "¿Puedo meter a mi mamá?");
  assert.equal(rated.body.item.by, "Carla");
  const conv7 = await carla("/operations/api/mia-chats/7/conversation");
  assert.equal(conv7.body.can_rate, true);
  assert.equal(conv7.body.ratings["4"].rating, "down");
  const fbList = await sofi("/operations/api/mia-feedback");
  assert.equal(fbList.body.items.length, 1);
  assert.equal(fbList.body.stats.down, 1);
  assert.equal((await carla("/operations/api/mia-feedback")).status, 403);
  const fbConv = await sofi(`/operations/api/mia-feedback/${encodeURIComponent(fbList.body.items[0].id)}/convert`, { topic: "Beneficiarios: mamá", answer: "Sí, tu mamá puede quedar como beneficiaria conforme a las reglas del IMSS." });
  assert.equal(fbConv.body.item.learned_from.kind, "correction");
  assert.equal((await sofi("/operations/api/mia-feedback")).body.items.length, 0);
});
