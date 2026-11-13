import test from "node:test";
import assert from "node:assert/strict";
import { ExperimentStore, CLOSE_CURP_B, CLOSE_DEFAULT } from "../src/knowledge/experiments.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { hotLeadReason, HotLeadAlerts } from "../src/operations/hot-lead-alerts.js";

// 9-nov: para que Mia cierre más. Punto 1: prueba A/B del cierre (pedir la CURP). Punto 3: aviso inmediato
// a Captura cuando el cliente está listo para comprar.

test("prueba A/B del cierre: arranca sola una vez y reemplaza solo la pregunta final", () => {
  const exp = new ExperimentStore(null);
  const item = exp.seed({ slot: "contextual_plan_explanation", name: "Cierre", bText: CLOSE_CURP_B });
  assert.equal(item.a_text, CLOSE_DEFAULT);
  assert.equal(exp.seed({ slot: "contextual_plan_explanation", name: "Cierre", bText: CLOSE_CURP_B }), null, "no se duplica");
  exp.finish(item.id, "A");
  assert.equal(exp.seed({ slot: "contextual_plan_explanation", name: "Cierre", bText: CLOSE_CURP_B }), null, "ya corrió: no se reinicia al redesplegar");
  const fresh = new ExperimentStore(null);
  fresh.seed({ slot: "contextual_plan_explanation", name: "Cierre", bText: CLOSE_CURP_B });
  const explanation = `Claro. El Plan 1 incluye… El primer pago se hace hasta que tu alta ya está vigente. ${CLOSE_DEFAULT}`;
  const hits = [1, 2, 3, 4, 5, 6, 7, 8].map(id => fresh.apply("contextual_plan_explanation", id, explanation));
  assert.ok(hits.some(h => h.variant === "A") && hits.some(h => h.variant === "B"));
  for (const h of hits) assert.ok(h.text.startsWith("Claro. El Plan 1 incluye…") && h.text.endsWith(h.variant === "B" ? "¿Me la compartes?" : CLOSE_DEFAULT));
  assert.equal(fresh.apply("contextual_plan_explanation", 1, "Otra respuesta"), null);
});

test("al cierre B, la CURP o un 'sí' aceptan", () => {
  const memory = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, ultima_respuesta_agente: `Claro. El Plan 1 incluye… ${CLOSE_CURP_B}` };
  assert.equal(confirmsStart("GOMA800101HDFRRN09", memory), true);
  assert.equal(confirmsStart("Mi curp es GOMA800101HDFRRN09 gracias", memory), true);
  assert.equal(confirmsStart("Sí", memory), true);
  assert.equal(analyzeNextSale("Sí, claro", memory).authorized, true);
  assert.equal(analyzeNextSale("Ahorita no tengo la CURP a la mano", memory).authorized, false);
});

test("cliente listo para comprar: motivo y un aviso cada 24 h", async () => {
  const now = new Date("2026-11-09T17:00:00Z");
  assert.equal(hotLeadReason({ text: "Me urge, necesito estar dado de alta antes del lunes", now }), "Tiene prisa");
  assert.equal(hotLeadReason({ answerKey: "payment_method", now }), "Pregunta cómo se paga");
  assert.equal(hotLeadReason({ answerKey: "requirements", now }), "Pregunta qué documentos necesita");
  assert.equal(hotLeadReason({ answerKey: "price", now }), null, "preguntar el precio solo no basta");
  assert.equal(hotLeadReason({ memory: { sales_cycle: { authorized: true } }, answerKey: "payment_method", now }), null, "ya aceptó: lo sigue el aviso de documentos");
  assert.equal(hotLeadReason({ memory: { capture_intervention: { active: true } }, answerKey: "payment_method", now }), null);
  assert.equal(hotLeadReason({ memory: { hot_lead_alert: { at: "2026-11-09T10:00:00Z" } }, answerKey: "payment_method", now }), null, "ya se avisó hoy");
  const notes = []; const merged = {};
  const alerts = new HotLeadAlerts({ memories: { async merge(id, p) { merged[id] = p; } }, notifier: { areaUsers: () => ["pamela"], async notify(n) { notes.push(n); } } });
  await alerts.alert({ conversation_id: 11347, memory: { nombre: "Laura", sales_cycle: { recommended_plan: "plan_1" } }, text: "Necesito estar dado de alta antes de este lunes", reason: "Tiene prisa", now });
  assert.equal(notes[0].kind, "hot_lead");
  assert.deepEqual(notes[0].to, ["pamela"]);
  assert.match(notes[0].body, /^Laura \(Plan 1\): tiene prisa · "Necesito estar dado de alta antes de este lunes" · #11347/);
  assert.equal(notes[0].url, "/operations?area=chats&chat=11347");
  assert.equal(merged[11347].hot_lead_alert.reason, "Tiene prisa");
});
