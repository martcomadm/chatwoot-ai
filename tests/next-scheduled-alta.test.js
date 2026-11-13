// Pedido 11-nov: botón en Captura para agendar el alta otro día. El expediente se queda en Captura,
// no cuenta tiempo hasta esa fecha y Mia le avisa al cliente que su trámite queda en espera.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine, scheduledDateLabel } from "../src/operations/workflow-engine.js";
import { renderCustomerMessage } from "../src/operations/customer-messages.js";
import { operationsMemoryFromSale } from "../src/operations/onboarding-service.js";
import { urgencyOf, hoursInQueue, queueEnteredAt } from "../src/operations/supervision-service.js";
import { canRunAction } from "../src/operations/access/areas.js";
import { followUpMessage, altaOnHold } from "../src/core/follow-up.js";
import { coldLeadSkipReason } from "../src/operations/cold-lead-alerts.js";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-sched-"));
  const wf = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  const sale = wf.openAuthorizedSale({ conversation_id: 7, customer: { nombre: "Brenda" }, sale: { plan: "plan_1", authorized: true } });
  return { wf, sale };
}
const NOW = new Date("2026-11-11T16:00:00-06:00");
const HOURS = { capture: 4 };

test("agendar el alta: se queda en Captura, sin contar tiempo, y Mia avisa al cliente", () => {
  const { wf, sale } = setup();
  const after = wf.scheduleCapture(sale.sale_id, { date: "2026-11-16", note: "le pagan en la quincena", by: "Ana" }, NOW);
  assert.equal(after.queue, "capture");
  assert.equal(after.status, sale.status);
  assert.deepEqual({ date: after.capture.scheduled.date, note: after.capture.scheduled.note, by: after.capture.scheduled.by }, { date: "2026-11-16", note: "le pagan en la quincena", by: "Ana" });
  const event = after.events.at(-1);
  assert.equal(event.type, "capture.scheduled");
  const text = renderCustomerMessage("capture.scheduled", { sale: after, details: event.details });
  assert.match(text, /agendada para el lunes 16 de noviembre/);
  assert.match(text, /en espera/);
  assert.equal(renderCustomerMessage("capture.scheduled", { sale: after, details: { ...event.details, notify_customer: false } }), null);
  // Días después sigue sin atraso; el día agendado empieza a contar desde cero.
  const days = n => NOW.getTime() + n * 24 * 3600 * 1000;
  assert.equal(urgencyOf(after, HOURS, days(3)), "scheduled");
  assert.equal(hoursInQueue(after, days(3)), 0);
  const dayStart = Date.parse("2026-11-16T00:00:00-06:00");
  assert.equal(Date.parse(queueEnteredAt(after)), dayStart);
  assert.equal(urgencyOf(after, HOURS, dayStart + 1 * 3600 * 1000), "ok");
  assert.equal(urgencyOf(after, HOURS, dayStart + 5 * 3600 * 1000), "overdue");
});

test("fechas inválidas y permisos", () => {
  const { wf, sale } = setup();
  assert.throws(() => wf.scheduleCapture(sale.sale_id, { date: "2026-11-11" }, NOW), /después de hoy/);
  assert.throws(() => wf.scheduleCapture(sale.sale_id, { date: "" }, NOW), /Elige la fecha/);
  assert.throws(() => wf.scheduleCapture(sale.sale_id, { date: "2027-06-01" }, NOW), /3 meses/);
  assert.throws(() => wf.resumeCapture(sale.sale_id), /no tiene alta agendada/);
  assert.equal(canRunAction({ areas: ["captura"] }, "capture/schedule"), true);
  assert.equal(canRunAction({ areas: ["captura"] }, "capture/resume"), true);
  assert.equal(canRunAction({ areas: ["validacion"] }, "capture/schedule"), false);
  wf.store.update(sale.sale_id, { status: "waiting_validation", queue: "validation" }, "x");
  assert.throws(() => wf.scheduleCapture(sale.sale_id, { date: "2026-11-16" }, NOW), /no permitido/);
});

test("quitar la fecha o iniciar la captura: el tiempo cuenta desde ese momento", () => {
  const { wf, sale } = setup();
  wf.scheduleCapture(sale.sale_id, { date: "2026-11-16" }, NOW);
  const resumed = wf.resumeCapture(sale.sale_id, { by: "Ana" });
  assert.equal(resumed.capture.scheduled, null);
  assert.equal(resumed.events.at(-1).type, "capture.schedule_resumed");
  assert.ok(Date.now() - Date.parse(resumed.queue_entered_at) < 5000);
  assert.equal(urgencyOf(resumed, HOURS), "ok");
  wf.scheduleCapture(sale.sale_id, { date: "2026-12-20" }, NOW);
  const started = wf.startCapture(sale.sale_id, { id: "ana", name: "Ana" });
  assert.equal(started.capture.scheduled, null);
  assert.equal(started.status, "capture_in_progress");
});

test("mientras espera, Mia no insiste con documentos ni se avisa cliente frío", () => {
  const { wf, sale } = setup();
  const after = wf.scheduleCapture(sale.sale_id, { date: "2026-11-16" }, NOW);
  const ops = operationsMemoryFromSale(after);
  assert.equal(ops.scheduled_alta, "2026-11-16");
  const memory = { sales_cycle: { authorized: true }, operations: { ...ops, scheduled_alta: "2999-01-01" } };
  assert.equal(altaOnHold(memory), true);
  assert.equal(followUpMessage(memory, 0), null);
  assert.equal(coldLeadSkipReason(memory, { mia_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString() }), "scheduled_alta");
  // Ya llegó el día: vuelve a aplicar lo normal.
  const due = { sales_cycle: { authorized: true }, operations: { ...ops, scheduled_alta: "2020-01-01" } };
  assert.equal(altaOnHold(due), false);
  assert.notEqual(followUpMessage(due, 0), null);
  assert.equal(scheduledDateLabel("2026-11-16"), "lunes 16 de noviembre");
});
