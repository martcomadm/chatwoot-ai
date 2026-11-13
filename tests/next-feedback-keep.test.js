// 13-nov: etiqueta "Se queda" en Correcciones: Mia aplica esas correcciones siempre.
import test from "node:test";
import assert from "node:assert/strict";
import { ReplyFeedbackStore } from "../src/knowledge/reply-feedback.js";

test("las correcciones que se quedan siempre entran a las instrucciones de Mia, aunque haya muchas nuevas", () => {
  const store = new ReplyFeedbackStore(null);
  const first = store.rate({ conversationId: 1, messageId: "a", rating: "down", correction: "La asesoría no tiene costo, es gratis.", miaText: "Plan 1 $1,100…", customerText: "costo de la asesoría", user: { name: "Carla" } });
  store.keep(first.id, "Sofi");
  for (let i = 0; i < 40; i++) store.rate({ conversationId: 100 + i, messageId: "m", rating: "down", correction: `Corrección número ${i} con texto suficiente`, miaText: "x", customerText: "y", user: { name: "Carla" } });
  const block = store.promptBlock();
  assert.match(block, /CORRECCIONES FIJAS DEL EQUIPO[\s\S]*La asesoría no tiene costo, es gratis\./);
  assert.equal((block.match(/Debió decir: Corrección número/g) || []).length, 25, "las demás: solo las 25 más recientes");
  assert.equal(store.list({ status: "kept" }).length, 1);
  assert.equal(store.list().length, 40, "la que se queda ya no está en Pendientes");
  assert.equal(store.stats().kept, 1);
  store.unkeep(first.id, "Sofi");
  assert.equal(store.list({ status: "kept" }).length, 0);
  assert.doesNotMatch(store.promptBlock(), /CORRECCIONES FIJAS/);
  assert.throws(() => store.unkeep(first.id, "Sofi"), /no está marcada/);
  assert.throws(() => store.keep("no-existe", "Sofi"), /No existe/);
});
