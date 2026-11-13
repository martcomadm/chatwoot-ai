import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ExperimentStore, SLOTS, variantFor } from "../src/knowledge/experiments.js";
import { AD_OPENINGS } from "../src/sales/ad-openings.js";

// Pruebas A/B de mensajes (4-nov, punto 4).
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-ab-")), "x.json");

test("crear prueba: valida frases necesarias, una activa por mensaje y texto distinto", () => {
  const ex = new ExperimentStore(file());
  assert.throws(() => ex.create({ slot: "otro", bText: "x".repeat(30) }), /no se puede probar/);
  assert.throws(() => ex.create({ slot: "ad_opening:case_review", bText: "Hola, cuéntame de tu caso por favor, ¿qué necesitas?" }), /en qué año empezaste a cotizar/);
  assert.throws(() => ex.create({ slot: "ad_opening:case_review", bText: AD_OPENINGS.case_review }), /igual a la actual/);
  ex.create({ slot: "ad_opening:case_review", bText: "¡Claro! Revisemos tu caso: ¿en qué año empezaste a cotizar y hace cuánto lo dejaste?" }, "Sofi");
  assert.throws(() => ex.create({ slot: "ad_opening:case_review", bText: "Otra versión: ¿en qué año empezaste a cotizar?" }), /Ya hay una prueba activa/);
});

test("reparto estable ~50/50, respeta el saludo antes, no toca textos armados distinto", () => {
  const ex = new ExperimentStore(file());
  const B = "¡Claro! Revisemos tu caso: ¿en qué año empezaste a cotizar y hace cuánto lo dejaste?";
  const item = ex.create({ slot: "ad_opening:case_review", bText: B });
  let b = 0;
  for (let id = 1; id <= 400; id++) {
    const hit = ex.apply("ad_opening:case_review", id, AD_OPENINGS.case_review);
    assert.equal(hit.variant, variantFor(item.id, id));
    assert.equal(hit.text, hit.variant === "B" ? B : AD_OPENINGS.case_review);
    if (hit.variant === "B") b++;
  }
  assert.ok(b > 160 && b < 240, `reparto ${b}/400`);
  const idB = [...Array(50).keys()].map(i => i + 1).find(id => variantFor(item.id, id) === "B");
  assert.equal(ex.apply("ad_opening:case_review", idB, `¡Hola! Soy Mia de MARTCOM. ${AD_OPENINGS.case_review}`).text, `¡Hola! Soy Mia de MARTCOM. ${B}`);
  assert.equal(ex.apply("ad_opening:case_review", idB, `Tenemos dos planes… ${AD_OPENINGS.case_review} extra`), null);
  assert.equal(ex.apply("progressive_opening", idB, "cualquier texto"), null);
});

test("resultados por versión y ganadora B queda permanente (y se puede revertir)", () => {
  const f = file();
  const ex = new ExperimentStore(f);
  const item = ex.create({ slot: "followup:menu", bText: SLOTS["followup:menu"].defaultText.replace("Hola de nuevo 😊", "¿Seguimos? 😊") });
  const memories = [
    { experiments: { [item.id]: { variant: "A", replied_at: "x" } }, sales_cycle: { authorized: true }, operations: { documents_complete: true } },
    { experiments: { [item.id]: { variant: "A" } } },
    { experiments: { [item.id]: { variant: "B", replied_at: "x" } }, sales_cycle: { authorized: true } },
    { experiments: { [item.id]: { variant: "B", replied_at: "x" } } },
    { nombre: "sin prueba" },
  ];
  const r = ex.results(item.id, memories);
  assert.deepEqual([r.A.sent, r.A.replied_pct, r.A.accepted_pct, r.A.docs], [2, 50, 50, 1]);
  assert.deepEqual([r.B.sent, r.B.replied_pct, r.B.accepted_pct], [2, 100, 50]);
  assert.equal(r.enough, false);
  ex.finish(item.id, "B", "Sofi");
  const reloaded = new ExperimentStore(f);
  assert.equal(reloaded.apply("followup:menu", 1, SLOTS["followup:menu"].defaultText).text, item.b_text, "todos reciben la ganadora");
  assert.equal(reloaded.apply("followup:menu", 1, SLOTS["followup:menu"].defaultText).experiment, null);
  reloaded.clearOverride("followup:menu");
  assert.equal(reloaded.apply("followup:menu", 1, SLOTS["followup:menu"].defaultText), null);
});

import { FollowUpService, FollowUpStore } from "../src/core/follow-up.js";
import { NEED_MENU_TEXT } from "../src/sales/need-menu.js";
test("el segundo seguimiento usa la versión A/B del menú y la registra en la memoria", async () => {
  const ex = new ExperimentStore(file());
  const B = NEED_MENU_TEXT.replace("Hola de nuevo 😊", "¿Seguimos? 😊");
  const item = ex.create({ slot: "followup:menu", bText: B });
  const id = [...Array(60).keys()].map(i => i + 1).find(n => variantFor(item.id, n) === "B");
  let memory = { ultima_respuesta_agente: "¿actualmente cuentas con IMSS?", followups_sent: ["x"] };
  const sent = [];
  const T0 = new Date("2026-11-04T16:00:00Z");
  const service = new FollowUpService({
    store: new FollowUpStore(file()),
    chatwoot: { async getConversation() { return { id, inbox_id: 7, status: "open", labels: [], meta: { assignee: { id: 53 } }, messages: [] }; }, async sendMessage(_id, text) { sent.push(text); } },
    labels: { async mergeSafe() {} },
    memories: { get: () => structuredClone(memory), async set(_id, m) { memory = m; } },
    config: { chatwoot: { inboxId: 7, agentId: 53 } },
  });
  service.experiments = ex;
  service.afterReply(id, { customerAt: T0, now: T0 });
  service.store.set(id, { ...service.store.get(id), sent: 1 });
  await service.tick(new Date(T0.getTime() + 4 * 3600 * 1000));
  assert.equal(sent.at(-1), B);
  assert.equal(memory.experiments[item.id].variant, "B");
  assert.equal(memory.ultima_respuesta_agente, B);
});
