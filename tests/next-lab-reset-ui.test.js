import test from "node:test";
import assert from "node:assert/strict";
import { operationsPage } from "../src/operations/operations-page.js";

test("Operations muestra control LAB para reiniciar una conversación", () => {
  const html = operationsPage();
  assert.match(html, /Laboratorio · Reiniciar conversación de prueba/);
  assert.match(html, /id="resetConversationId"/);
  assert.match(html, /id="resetConversationBtn"/);
  assert.match(html, /resetLabConversation\(\)/);
});

test("control LAB exige confirmación RESET y usa endpoint protegido", () => {
  const html = operationsPage();
  assert.match(html, /RESET /);
  assert.match(html, /\/operations\/api\/lab\/reset-conversation/);
  assert.match(html, /conversation_id:id/);
  assert.match(html, /confirm:'RESET '\+id/);
});

test("Operations explica el alcance aislado del reset", () => {
  const html = operationsPage();
  assert.match(html, /Borra solo la memoria NEXT y los expedientes asociados/);
  assert.match(html, /No toca Chatwoot ni otras conversaciones/);
});
