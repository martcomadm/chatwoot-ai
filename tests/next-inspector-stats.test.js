import test from "node:test";
import assert from "node:assert/strict";
import { buildStats, previousRange, bucketKey, defaultRange } from "../src/inspector/stats-service.js";

// Estadísticas del Inspector (29-oct): semanas, meses, comparación y desgloses.
const ev = (id, iso, type, details = {}) => ({ conversationId: id, timestamp: iso, type, details });

test("periodos: semanas empiezan en lunes; meses y comparaciones", () => {
  assert.equal(bucketKey("2026-10-29", "week"), "2026-10-26");
  assert.equal(bucketKey("2026-10-29", "month"), "2026-10");
  assert.deepEqual(previousRange("2026-10-01", "2026-10-29", "day"), { from: "2026-09-01", to: "2026-09-29" });
  assert.deepEqual(previousRange("2026-09-01", "2026-09-30", "week"), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(previousRange("2026-10-26", "2026-10-29", "day"), { from: "2026-10-22", to: "2026-10-25" });
  assert.equal(defaultRange("week", "2026-10-29").from, "2026-08-10");
});

test("cuenta nuevas, aceptaron, conversión, calidad, ventas y desgloses por semana", () => {
  const eventsByConv = new Map([
    [1, [ev(1, "2026-10-20T16:00:00Z", "ai_reply_sent", { customer_text: "Dejé de cotizar, quiero seguir sumando para pensionarme", customer_at: "2026-10-20T15:59:30Z", decision_source: "ad_opening:pension", reply: "a" }),
         ev(1, "2026-10-20T16:05:00Z", "ai_reply_sent", { customer_text: "si", decision_source: "llm", reply: "b" }),
         ev(1, "2026-10-21T16:00:00Z", "authorized_sale_workflow", { documents_complete: true })]],
    [2, [ev(2, "2026-10-27T18:00:00Z", "ai_reply_sent", { customer_text: "¡Hola! Quiero más información", decision_source: "fallback", reply: "x" }),
         ev(2, "2026-10-27T18:10:00Z", "ai_reply_sent", { customer_text: "ok", decision_source: "fallback", reply: "x" }),
         ev(2, "2026-10-28T03:30:00Z", "ignored_out_of_schedule", {}),
         ev(2, "2026-10-28T18:00:00Z", "followup_no_response", {})]],
  ]);
  const memories = [{ id: 1, edad: 62, commercial_need: { weeks: true }, sales_cycle: { selected_plan: "plan_2", authorized: true } }, { id: 2, edad: 35, sales_cycle: { deferral: "later" } }];
  const sales = [{ sale_id: "S1", conversation_id: 1, created_at: "2026-10-21T16:00:00Z", sale: { plan: "plan_2" }, validity: { confirmed_at: "2026-10-23T16:00:00Z" }, payment: { validated_at: "2026-10-27T16:00:00Z" }, events: [] }];
  const s = buildStats({ memories, eventsByConv, sales, group: "week", from: "2026-10-19", to: "2026-10-29", now: new Date("2026-10-29T18:00:00Z") });
  assert.deepEqual(s.buckets.map(b => b.key), ["2026-10-19", "2026-10-26"]);
  const [w1, w2] = s.buckets;
  assert.equal(w1.nuevas, 1); assert.equal(w1.aceptaron, 1); assert.equal(w1.conversion, 100); assert.equal(w1.documentos, 1);
  assert.equal(w1.tiempo_respuesta, 30);
  assert.equal(w2.nuevas, 1); assert.equal(w2.pct_genericas, 100); assert.equal(w2.repetidas, 1);
  assert.equal(w2.fuera_horario, 1); assert.equal(w2.no_contestaron, 1); assert.equal(w2.partial, true);
  assert.equal(w1.altas, 1); assert.equal(w2.pagadas, 1); assert.equal(w2.ingreso, 1500);
  assert.equal(s.totals.nuevas, 2); assert.equal(s.totals.conversion, 50);
  assert.equal(s.breakdowns.entry.find(e => e.key === "pension").aceptaron, 1);
  assert.equal(s.breakdowns.entry.find(e => e.key === "info").count, 1);
  assert.equal(s.breakdowns.plan[0].label, "Plan 2");
  assert.equal(s.breakdowns.age.find(a => a.key === "60 o más").count, 1);
  assert.equal(s.compare.from, "2026-10-08");
  // 27-oct 21:30 hora de México = martes; 28-oct 03:30Z = 27-oct 21:30 local.
  assert.equal(s.heatmap.cells[1][21], 1);
});

import { MiaConsole } from "../src/inspector/mia-console.js";
test("CSV de chats: número del cliente, línea de WhatsApp, cómo llegó y enlace", async () => {
  const events = [ev(10, "2026-10-28T16:00:00Z", "ai_reply_sent", { customer_text: "Dejé de cotizar, quiero seguir sumando para pensionarme", decision_source: "ad_opening:pension", reply: "a" }), ev(11, "2026-10-20T16:00:00Z", "ai_reply_sent", { customer_text: "hola", reply: "b" })];
  const mc = new MiaConsole({
    config: { ai: { timezone: "America/Mexico_City" }, inspector: {}, chatwoot: { baseUrl: "https://chat.test", accountId: 1 } },
    memories: { list: () => [{ id: 10, nombre: "Rosa \"La\" López", edad: 61, sales_cycle: { authorized: true, selected_plan: "plan_1" } }, { id: 11 }] },
    inspectorEvents: { listAll: () => events, get: id => events.filter(e => e.conversationId === id) },
    chatwoot: { async getConversation(id) { return { id, inbox_id: 7, meta: { sender: { name: "Rosa", phone_number: "+525512345678" }, assignee: { name: "Ana" } }, labels: ["venta"] }; }, async getInbox() { return { name: "WhatsApp Ventas", phone_number: "+525500000000" }; } },
  });
  // El chat 12 tuvo actividad el 28 pero se creó el 20: no sale. El 13 se creó a las 23:50 del 28 y Mia contestó el 29: sí sale.
  events.push(ev(12, "2026-10-20T16:00:00Z", "ai_reply_sent", { customer_text: "hola", reply: "c" }), ev(12, "2026-10-28T17:00:00Z", "ai_reply_sent", { customer_text: "sigo", reply: "d" }));
  events.push(ev(13, "2026-10-29T13:01:00Z", "ai_reply_sent", { customer_text: "Información", reply: "e" }));
  const created = { 13: Date.parse("2026-10-29T05:50:00Z") / 1000 };
  const getConversation = mc.chatwoot.getConversation;
  mc.chatwoot.getConversation = async id => ({ ...(await getConversation(id)), created_at: created[id] });
  mc.memories = { list: () => [...[10, 11, 12, 13].map(id => ({ id, ...(id === 10 ? { nombre: "Rosa \"La\" López", edad: 61, sales_cycle: { authorized: true, selected_plan: "plan_1" } } : {}) }))] };
  const out = await mc.exportCsv({ from: "2026-10-28", to: "2026-10-28" });
  assert.deepEqual(out.text.trim().split("\r\n").slice(1).map(r => r.split(",")[0]), ['"10"', '"13"']);
  assert.equal(out.count, 2);
  assert.equal(out.name, "mia-chats-2026-10-28.csv");
  const [head, row] = out.text.replace(/^﻿/, "").trim().split("\r\n");
  assert.match(head, /"Teléfono del cliente","Línea de WhatsApp \(bandeja\)","Número de la línea","Cómo llegó"/);
  assert.match(row, /^"10",/);
  assert.match(row, /"Rosa ""La"" López","\+525512345678","WhatsApp Ventas","\+525500000000","Anuncio: seguir sumando semanas"/);
  assert.match(row, /"Sí".*"Ana","venta","https:\/\/chat\.test\/app\/accounts\/1\/conversations\/10"$/);
});
