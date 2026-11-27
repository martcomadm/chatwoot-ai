import test from "node:test";
import assert from "node:assert/strict";
import { buildImpact } from "../src/inspector/impact-service.js";

// Tablero de impacto (5-nov): antes vs después del cambio y resultado de cada mejora.
const ev = (conversationId, type, timestamp, details = {}) => ({ conversationId, type, timestamp, details });
const now = new Date("2026-11-12T18:00:00Z");

test("impacto: compara conversión antes/después y mide cada herramienta nueva", () => {
  const byConv = new Map([
    // Antes del cambio (29-oct al 4-nov): 2 chats, 1 venta.
    [1, [ev(1, "ai_reply_sent", "2026-10-30T16:00:00Z", { customer_text: "Información y revisar mi caso con mi NSS" }), ev(1, "authorized_sale_workflow", "2026-10-30T17:00:00Z", { documents_complete: true })]],
    [2, [ev(2, "ai_reply_sent", "2026-11-02T16:00:00Z", { customer_text: "Información y revisar mi caso con mi NSS" })]],
    // Después (5 al 11-nov… hasta hoy 12): 4 chats, 2 ventas.
    [3, [ev(3, "ai_reply_sent", "2026-11-06T16:00:00Z", { customer_text: "Información y revisar mi caso con mi NSS" }), ev(3, "ai_reply_sent", "2026-11-06T16:05:00Z", { customer_text: "Empecé en 1988", decision_source: "case_diagnosis:ley_73" }), ev(3, "authorized_sale_workflow", "2026-11-06T16:10:00Z", { documents_complete: false })]],
    [4, [ev(4, "ai_reply_sent", "2026-11-07T16:00:00Z", { customer_text: "¡Hola! Quiero más información" }), ev(4, "followup_sent", "2026-11-07T19:00:00Z", { step: 2, text: "Hola de nuevo 😊 … Responde con el número:\n1️⃣ …" }), ev(4, "need_menu_choice", "2026-11-07T19:30:00Z"), ev(4, "cold_lead_alert", "2026-11-07T22:00:00Z", { kind: "cold_lead" }), ev(4, "capture_intervention", "2026-11-07T22:10:00Z"), ev(4, "authorized_sale_workflow", "2026-11-07T23:00:00Z", { documents_complete: true })]],
    [5, [ev(5, "ai_reply_sent", "2026-11-08T16:00:00Z", { customer_text: "¡Hola! Quiero más información" }), ev(5, "followup_sent", "2026-11-09T12:00:00Z", { step: 3, text: "¿Prefieres que un asesor te llame unos minutos…?" }), ev(5, "handoff", "2026-11-09T13:00:00Z", { reason: "El cliente aceptó que un asesor le llame (último seguimiento)" })]],
    [6, [ev(6, "ai_reply_sent", "2026-11-10T16:00:00Z", { customer_text: "Hola", decision_source: "team_answer:abc" }), ev(6, "ai_reply_sent", "2026-11-10T16:01:00Z", { decision_source: "team_answer:abc" })]],
  ]);
  const feedback = [{ rating: "up", at: "2026-11-08T16:00:00Z" }, { rating: "up", at: "2026-11-08T16:00:00Z" }, { rating: "down", at: "2026-11-09T16:00:00Z" }, { rating: "up", at: "2026-10-30T16:00:00Z" }];
  const r = buildImpact({ eventsByConv: byConv, feedback, since: "2026-11-05", now });
  assert.equal(r.days, 8, "del 5 al 12-nov");
  assert.deepEqual([r.before.from, r.before.to], ["2026-10-28", "2026-11-04"]);
  assert.deepEqual([r.before.nuevas, r.before.aceptaron, r.before.conversion], [2, 1, 50]);
  assert.deepEqual([r.after.nuevas, r.after.aceptaron, r.after.conversion, r.after.documentos], [4, 2, 50, 1]);
  assert.deepEqual([r.after.diagnosis.sent, r.after.diagnosis.accepted], [1, 1]);
  assert.deepEqual([r.after.menu.sent, r.after.menu.answered, r.after.menu.accepted], [1, 1, 1]);
  assert.deepEqual([r.after.call.sent, r.after.call.took], [1, 1]);
  assert.deepEqual([r.after.alert_lead.sent, r.after.alert_lead.accepted], [1, 1]);
  assert.deepEqual([r.after.intervened.sent, r.after.intervened.saved, r.after.intervened.saved_docs], [1, 1, 1], "aceptó después de intervenir = venta salvada");
  assert.equal(r.after.team_answers, 2);
  assert.deepEqual(r.after.ratings, { up: 2, down: 1, approval: 66.7 });
  assert.deepEqual(r.before.ratings, { up: 1, down: 0, approval: 100 });
  const cr = r.entries.find(e => e.key === "case_review");
  assert.deepEqual([cr.before.nuevas, cr.before.conversion, cr.after.nuevas, cr.after.conversion], [2, 50, 1, 100]);
  assert.equal(r.partial_day, true);
});

test("impacto: venta antes de intervenir no cuenta como salvada; aviso de pocos días", () => {
  const byConv = new Map([[9, [ev(9, "ai_reply_sent", "2026-11-11T16:00:00Z", { customer_text: "Hola" }), ev(9, "authorized_sale_workflow", "2026-11-11T16:10:00Z"), ev(9, "capture_intervention", "2026-11-11T17:00:00Z")]]]);
  const r = buildImpact({ eventsByConv: byConv, since: "2026-11-10", now });
  assert.equal(r.after.intervened.saved, 0);
  assert.match(r.note, /pocos días/);
});
