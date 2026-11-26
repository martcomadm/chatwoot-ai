import test from "node:test";
import assert from "node:assert/strict";
import { toConversationItems } from "../src/operations/conversation-items.js";

// 26-nov: en Operaciones (Chats de Mia y expediente, todas las áreas) la conversación también muestra
// las notas internas de Chatwoot, con quién la escribió.
const list = [
  { id: 1, message_type: 0, content: "Yo me comunico con ustedes", created_at: 100 },
  { id: 2, message_type: 1, content: "De acuerdo, quedo atenta a tu mensaje.", created_at: 110, sender: { id: 53, type: "user" } },
  { id: 3, message_type: 1, private: true, content: "Cliente pide que le marquen el lunes", created_at: 120, sender: { id: 88, type: "user", name: "Asesora Prueba" } },
  { id: 4, message_type: 1, private: true, content: "🎤 Transcripción de la nota de voz del cliente:\n«ya se la mandé»", created_at: 130, sender: { id: 53, type: "user" } },
  { id: 5, message_type: 2, content: "Conversación asignada", created_at: 140 },
];
const base = { customerName: "Cliente Prueba", teamTexts: new Map(), agentId: 53 };

test("la conversación en Operaciones muestra todas las notas internas con su autor (26-nov)", () => {
  const items = toConversationItems(list, { ...base, includeNotes: true });
  assert.deepEqual(items.map(m => m.who), ["cliente", "mia", "nota", "nota"]);
  assert.equal(items[2].text, "Cliente pide que le marquen el lunes");
  assert.equal(items[2].name, "Asesora Prueba");
  assert.equal(items[3].name, "Mia");
});

test("sin includeNotes solo pasa la transcripción de voz", () => {
  const items = toConversationItems(list, base);
  assert.deepEqual(items.map(m => m.who), ["cliente", "mia", "nota"]);
  assert.ok(!items.some(m => /marquen el lunes/.test(m.text)));
});
