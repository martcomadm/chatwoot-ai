import { QUEUE_LABELS, WORK_AREAS } from "./access/areas.js";

const ISSUE_STATUSES = new Set(["alta_issue", "validity_issue", "payment_issue", "validation_rejected"]);
const HOUR = 60 * 60 * 1000;

// Eventos que cuentan como "trabajo terminado" de una persona en su área.
export const PERFORMANCE_EVENTS = Object.freeze({
  "capture.completed": { area: "captura", label: "Altas capturadas" },
  "validation.approved": { area: "validacion", label: "Validaciones aprobadas" },
  "validation.correction.requested": { area: "validacion", label: "Correcciones solicitadas" },
  "validation.rejected": { area: "validacion", label: "Rechazos" },
  "validity.confirmed": { area: "vigencia", label: "Vigencias confirmadas" },
  "payment.requested": { area: "cobranza", label: "Pagos solicitados" },
  "payment.validated": { area: "cobranza", label: "Pagos validados" },
});

// Desde cuándo está el expediente en su área actual.
export function queueEnteredAt(sale) {
  return sale?.queue_entered_at || sale?.updated_at || sale?.created_at || null;
}

export function hoursInQueue(sale, now = Date.now()) {
  const since = Date.parse(queueEnteredAt(sale) || "");
  return Number.isFinite(since) ? Math.max(0, (now - since) / HOUR) : 0;
}

// "ok" | "warning" (pasó 75% del tiempo) | "overdue" | "issue"
export function urgencyOf(sale, alertHours = {}, now = Date.now()) {
  if (ISSUE_STATUSES.has(sale?.status)) return "issue";
  const limit = Number(alertHours?.[sale?.queue]);
  if (!limit) return "ok";
  const hours = hoursInQueue(sale, now);
  if (hours >= limit) return "overdue";
  if (hours >= limit * 0.75) return "warning";
  return "ok";
}

function inRange(at, from, to) {
  const time = Date.parse(at || "");
  if (!Number.isFinite(time)) return false;
  if (from && time < Date.parse(`${from}T00:00:00-06:00`)) return false;
  if (to && time > Date.parse(`${to}T23:59:59.999-06:00`)) return false;
  return true;
}

export function buildOverview(sales = [], { alertHours = {}, from = null, to = null, now = Date.now() } = {}) {
  const active = sales.filter(sale => !["completed", "cancelled"].includes(sale.queue));

  const flow = WORK_AREAS.map(area => {
    const items = active.filter(sale => sale.queue === area.queue);
    const urgency = items.map(sale => urgencyOf(sale, alertHours, now));
    const oldest = items.reduce((max, sale) => Math.max(max, hoursInQueue(sale, now)), 0);
    return {
      area: area.key,
      queue: area.queue,
      label: area.label,
      total: items.length,
      unassigned: items.filter(sale => !sale.assignee).length,
      overdue: urgency.filter(value => value === "overdue").length,
      warning: urgency.filter(value => value === "warning").length,
      issues: urgency.filter(value => value === "issue").length,
      oldest_hours: Math.round(oldest * 10) / 10,
      limit_hours: alertHours?.[area.queue] ?? null,
    };
  });

  const alerts = active
    .map(sale => ({ sale, urgency: urgencyOf(sale, alertHours, now), hours: hoursInQueue(sale, now) }))
    .filter(item => item.urgency === "overdue" || item.urgency === "issue")
    .sort((a, b) => (a.urgency === "issue") - (b.urgency === "issue") || b.hours - a.hours)
    .map(({ sale, urgency, hours }) => ({
      sale_id: sale.sale_id,
      customer: sale.customer?.nombre || null,
      queue: sale.queue,
      queue_label: QUEUE_LABELS[sale.queue] || sale.queue,
      status: sale.status,
      urgency,
      hours: Math.round(hours * 10) / 10,
      limit_hours: alertHours?.[sale.queue] ?? null,
      assignee: sale.assignee || null,
    }));

  // Desempeño: eventos de cierre por persona dentro del rango, con tiempo promedio
  // desde que el expediente entró a la cola hasta que esa persona lo terminó.
  const people = new Map();
  let completedInRange = 0;
  let cancelledInRange = 0;
  for (const sale of sales) {
    const events = Array.isArray(sale.events) ? sale.events : [];
    // Cada evento guarda la cola DESPUÉS del cambio; recorremos en orden para saber
    // desde cuándo estaba el expediente en la cola que la persona terminó.
    let currentQueue = events[0]?.queue || "capture";
    let enteredAt = Date.parse(sale.created_at || events[0]?.at || "");
    for (const event of events) {
      const at = Date.parse(event.at || "");
      if (inRange(event.at, from, to)) {
        if (event.type === "payment.validated") completedInRange += 1;
        if (event.type === "supervision.cancelled") cancelledInRange += 1;
        const metric = PERFORMANCE_EVENTS[event.type];
        if (metric && event.actor?.username) {
          const key = event.actor.username;
          const person = people.get(key) || { username: key, name: event.actor.name || key, total: 0, by_event: {}, areas: new Set(), handling_ms: 0, handled: 0 };
          person.total += 1;
          person.by_event[event.type] = (person.by_event[event.type] || 0) + 1;
          person.areas.add(metric.area);
          if (Number.isFinite(enteredAt) && Number.isFinite(at) && at >= enteredAt) { person.handling_ms += at - enteredAt; person.handled += 1; }
          people.set(key, person);
        }
      }
      if (event.queue && event.queue !== currentQueue) { currentQueue = event.queue; enteredAt = at; }
    }
  }
  const performance = [...people.values()]
    .map(person => ({
      username: person.username,
      name: person.name,
      areas: [...person.areas],
      total: person.total,
      by_event: person.by_event,
      avg_hours: person.handled ? Math.round((person.handling_ms / person.handled / HOUR) * 10) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "es"));

  return {
    generated_at: new Date(now).toISOString(),
    range: { from, to },
    totals: {
      active: active.length,
      overdue: alerts.filter(item => item.urgency === "overdue").length,
      issues: alerts.filter(item => item.urgency === "issue").length,
      completed_in_range: completedInRange,
      cancelled_in_range: cancelledInRange,
    },
    flow,
    alerts,
    performance,
    performance_events: PERFORMANCE_EVENTS,
  };
}

// Bitácora unificada: movimientos de expedientes + bitácora administrativa.
export function buildAuditTrail(sales = [], adminEntries = [], { from = null, to = null, actor = null, saleId = null, limit = 500 } = {}) {
  const rows = [];
  for (const sale of sales) {
    if (saleId && sale.sale_id !== saleId) continue;
    for (const event of sale.events || []) {
      rows.push({ at: event.at, kind: "expediente", type: event.type, sale_id: sale.sale_id, customer: sale.customer?.nombre || null, queue: event.queue || null, actor: event.actor || null, details: event.details || {} });
    }
  }
  if (!saleId) {
    for (const entry of adminEntries) rows.push({ at: entry.at, kind: "admin", type: entry.type, sale_id: entry.details?.sale_id || null, customer: null, queue: null, actor: entry.actor || null, details: entry.details || {} });
  }
  const actorKey = actor ? String(actor).toLowerCase() : null;
  return rows
    .filter(row => inRange(row.at, from, to) || (!from && !to))
    .filter(row => !actorKey || (actorKey === "sistema" ? !row.actor : row.actor?.username === actorKey))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
}
