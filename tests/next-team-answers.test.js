import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { TeamAnswerStore } from "../src/knowledge/team-answers.js";
import { LearningInbox, extractPairs } from "../src/knowledge/learning-inbox.js";
import { AiServices } from "../src/ai/services.js";

// Respuestas de Mia editables por el equipo y "Preguntas que Mia no supo" (4-nov).
const tmp = name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-team-")), name);

test("respuestas del equipo: se guardan, se editan, coinciden por frase y entran a las instrucciones de la IA", () => {
  const file = tmp("a.json");
  const store = new TeamAnswerStore(file);
  assert.throws(() => store.create({ topic: "x", answer: "corta" }), /tema/);
  const card = store.create({ topic: "¿Puedo pagar con tarjeta?", answer: "Por ahora el pago es por transferencia, depósito u OXXO; no aceptamos tarjeta.", phrases: "pagar con tarjeta, tarjeta de crédito, con tarjeta" }, "Sofi");
  store.create({ topic: "Cita en clínica", answer: "Con tu alta vigente puedes pedir cita en tu clínica familiar del IMSS." }, "Sofi");
  assert.equal(new TeamAnswerStore(file).list().length, 2, "se guarda en disco");
  assert.equal(store.match("Hola, ¿puedo PAGAR con Tarjeta de crédito?").id, card.id);
  assert.equal(store.match("Hola, ¿puedo PAGAR con Tarjeta de crédito?").matched_phrase, "tarjeta de crédito", "gana la frase más larga");
  assert.equal(store.match("quiero información"), null);
  assert.equal(store.match("contarjeta"), null, "frase completa, no pedazo de palabra");
  const block = store.promptBlock();
  assert.match(block, /RESPUESTAS APROBADAS POR EL EQUIPO/);
  assert.match(block, /Tema: Cita en clínica/);
  store.update(card.id, { active: false }, "Ana");
  assert.equal(store.match("pagar con tarjeta"), null, "pausada no se usa");
  assert.doesNotMatch(store.promptBlock(), /tarjeta/);
  const ai = new AiServices(null, {});
  ai.teamAnswers = store;
  assert.match(ai.knowledge(), /Tema: Cita en clínica/);
  store.remove(card.id);
  assert.equal(store.list().length, 1);
});

test("pares pregunta del cliente → respuesta de una persona (sin Mia, notas privadas, plantillas ni datos personales)", () => {
  const msgs = [
    { id: 1, message_type: 0, content: "¿Puedo dar de alta a mi mamá como beneficiaria?", created_at: 10 },
    { id: 2, message_type: 1, content: "Claro, ¿quieres que iniciemos tu trámite?", sender: { id: 53, type: "user" }, created_at: 11 },
    { id: 3, message_type: 0, content: "Y si vive en otro estado también se puede?", created_at: 12 },
    { id: 4, message_type: 1, private: true, content: "MÍA → ASESOR", sender: { id: 53 }, created_at: 13 },
    { id: 5, message_type: 1, content: "Sí, puede estar en otro estado; se registra en la clínica más cercana a su domicilio.", sender: { id: 62, type: "user", name: "Jaqueline" }, created_at: 14 },
    { id: 6, message_type: 0, content: "Ok perfecto, le paso mis datos ahora mismo", created_at: 15 },
    { id: 7, message_type: 1, content: "Tu CURP es ROMN061018MJCJRDA5, ¿correcto? Te confirmo en un momento.", sender: { id: 62, type: "user" }, created_at: 16 },
    { id: 8, message_type: 0, content: "ok", created_at: 17 },
    { id: 9, message_type: 1, content: "Perfecto, en un momento te confirmo tu alta por aquí mismo.", sender: { id: 62, type: "user" }, created_at: 18 },
  ];
  const pairs = extractPairs(msgs, { isOwn: m => Number(m.sender?.id) === 53 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].question, "Y si vive en otro estado también se puede?");
  assert.match(pairs[0].answer, /clínica más cercana/);
  assert.equal(pairs[0].by, "Jaqueline");
});

test("bandeja: revisa chats que pasaron a una persona, no repite, y se resuelve", async () => {
  const memories = { list: () => [
    { id: 7, nombre: "Rosa", handoff: { status: "completed" }, actualizado_en: new Date().toISOString() },
    { id: 8, nombre: "Memo", actualizado_en: new Date().toISOString() },
  ] };
  let calls = 0;
  const chatwoot = { async getAllMessages(id) { calls++; return { payload: [
    { id: 1, message_type: 0, content: "¿Tienen oficina en Guadalajara para ir?", created_at: 1 },
    { id: 2, message_type: 1, content: "Todo el trámite es en línea por WhatsApp, no necesitas ir a ninguna oficina.", sender: { id: 62, type: "user", name: "Erika" }, created_at: 2 },
  ] }; } };
  const inbox = new LearningInbox({ file: tmp("l.json"), memories, chatwoot });
  assert.deepEqual(await inbox.scan(), { added: 1 });
  assert.equal(calls, 1, "solo el chat que pasó a una persona");
  assert.deepEqual(await inbox.scan(), { added: 0 }, "sin cambios no se vuelve a pedir");
  const [item] = inbox.list();
  assert.equal(item.customer_name, "Rosa");
  inbox.resolve(item.id, "converted", "Sofi", "abc");
  assert.equal(inbox.list().length, 0);
  assert.equal(inbox.list({ status: "all" })[0].team_answer_id, "abc");
});
