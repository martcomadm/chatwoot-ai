import { EventEmitter } from "node:events";
import { sendWebPush } from "./web-push.js";
import { urgencyOf } from "../supervision-service.js";

// Avisos para la gente de Operations: dentro de la página (sonido + aviso) y en el celular o la
// computadora con Web Push aunque la página esté cerrada.
//
// Quién recibe qué:
// - Nuevo expediente en un área → quienes trabajan esa área.
// - Te asignaron un expediente → esa persona.
// - Rechazo / incidencia → el área que debe corregir y Supervisión.
// - Comprobante recibido → Cobranza (o quien tenga el expediente).
// - El cliente escribió por WhatsApp con el expediente en proceso → quien lo tiene, o su área.
// - Expediente atrasado (pasó su tiempo objetivo) → quien lo tiene, o su área, y Supervisión. Una vez por etapa.

const AREA_OF_QUEUE = { capture: "captura", validation: "validacion", validity: "vigencia", payment: "cobranza" };
const AREA_LABEL = { captura: "Captura", validacion: "Validación", vigencia: "Vigencia", cobranza: "Cobranza", supervision: "Supervisión" };
const PLAN_LABEL = { plan_1: "Plan 1", plan_2: "Plan 2" };

const who = sale => sale?.customer?.nombre || "Cliente sin nombre";
const plan = sale => PLAN_LABEL[sale?.sale?.plan] ? ` · ${PLAN_LABEL[sale.sale.plan]}` : "";
const clip = (text, n = 120) => { const t = String(text || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export class OpsNotifier extends EventEmitter {
  constructor({ users, store, settings = null, subject = "https://martcom-econtact.mx", sendPush = sendWebPush, logger = console } = {}) {
    super();
    this.users = users;
    this.store = store;
    this.settings = settings;
    this.subject = subject;
    this.sendPush = sendPush;
    this.logger = logger;
    this.lastCustomerPing = new Map();
  }

  // Personas activas que trabajan un área (no cuenta Admin: solo quien la tiene asignada).
  areaUsers(area) {
    return (this.users?.list?.() || []).filter(u => u.active && (u.areas || []).includes(area)).map(u => u.username);
  }

  // ── Eventos del expediente ─────────────────────────────────────────
  plan(event = {}) {
    const sale = event.sale;
    if (!sale?.sale_id) return null;
    const d = event.details || {};
    const area = AREA_OF_QUEUE[sale.queue];
    const label = AREA_LABEL[area] || "";
    const base = { sale_id: sale.sale_id, url: `/operations/sales/${encodeURIComponent(sale.sale_id)}` };
    switch (event.type) {
      case "sale.created":
        return { ...base, kind: "new", to: this.areaUsers("captura"), title: "Nueva venta para Captura", body: `${who(sale)}${plan(sale)}` };
      case "capture.completed":
        return { ...base, kind: "new", to: this.areaUsers("validacion"), title: "Alta lista para validar", body: `${who(sale)}${plan(sale)}` };
      case "validation.approved":
        return { ...base, kind: "new", to: this.areaUsers("vigencia"), title: "Expediente esperando vigencia", body: `${who(sale)}${plan(sale)}` };
      case "validity.confirmed":
        return { ...base, kind: "new", to: this.areaUsers("cobranza"), title: "Vigencia confirmada: toca el pago", body: `${who(sale)}${plan(sale)}` };
      case "supervision.returned":
        return area ? { ...base, kind: "new", to: this.areaUsers(area), title: `Expediente regresado a ${label}`, body: `${who(sale)}${d.reason ? ` · ${clip(d.reason, 90)}` : ""}` } : null;
      case "assignment.changed":
        return d.to ? { ...base, kind: "assigned", to: [d.to], title: "Te asignaron un expediente", body: `${who(sale)}${label ? ` · ${label}` : ""}` } : null;
      case "validation.rejected":
        return { ...base, kind: "issue", to: [...this.areaUsers("captura"), ...this.areaUsers("supervision")], title: "Validación rechazada", body: `${who(sale)}${d.reason ? ` · ${clip(d.reason, 90)}` : ""}` };
      case "validity.issue":
        return { ...base, kind: "issue", to: [...this.areaUsers("vigencia"), ...this.areaUsers("supervision")], title: "Incidencia en vigencia", body: `${who(sale)}${d.reason || d.notes ? ` · ${clip(d.reason || d.notes, 90)}` : ""}` };
      case "payment.issue":
        return { ...base, kind: "issue", to: [...this.areaUsers("cobranza"), ...this.areaUsers("supervision")], title: "Incidencia en el pago", body: `${who(sale)}${d.reason || d.notes ? ` · ${clip(d.reason || d.notes, 90)}` : ""}` };
      case "payment.received":
        return { ...base, kind: "payment", to: sale.assignee?.username ? [sale.assignee.username] : this.areaUsers("cobranza"), title: "Comprobante de pago recibido", body: `${who(sale)}${plan(sale)}` };
      default:
        return null;
    }
  }

  async handleSaleEvent(event) {
    try {
      const n = this.plan(event);
      if (!n) return;
      // A nadie se le avisa de lo que él mismo hizo (p. ej. "Tomar expediente").
      const actor = event.sale?.events?.at?.(-1)?.actor?.username;
      await this.notify({ ...n, to: (n.to || []).filter(u => u !== actor) });
    } catch (error) { this.logger.error?.("Avisos de Operations:", error?.message || error); }
  }

  // El cliente escribió por WhatsApp y su expediente está en proceso (máximo un aviso cada 10 min).
  async customerMessage(sale, text, now = Date.now()) {
    if (!sale?.sale_id || ["completed", "cancelled"].includes(sale.queue)) return null;
    const last = this.lastCustomerPing.get(sale.sale_id);
    if (last !== undefined && now - last < 10 * 60 * 1000) return null;
    this.lastCustomerPing.set(sale.sale_id, now);
    const area = AREA_OF_QUEUE[sale.queue];
    const to = sale.assignee?.username ? [sale.assignee.username] : area ? this.areaUsers(area) : [];
    return this.notify({ sale_id: sale.sale_id, url: `/operations/sales/${encodeURIComponent(sale.sale_id)}`, kind: "customer", to, title: `${who(sale)} escribió por WhatsApp`, body: clip(text, 140) || "(adjunto)" });
  }

  // Expedientes que pasaron su tiempo objetivo: un aviso por etapa.
  async checkOverdue(sales = [], now = Date.now()) {
    const hours = this.settings?.alertHours?.() || {};
    let sent = 0;
    for (const sale of sales) {
      const area = AREA_OF_QUEUE[sale.queue];
      if (!area || urgencyOf(sale, hours, now) !== "overdue") continue;
      if (!this.store.markOnce(`overdue:${sale.sale_id}:${sale.queue}:${sale.queue_entered_at || ""}`)) continue;
      const owner = sale.assignee?.username ? [sale.assignee.username] : this.areaUsers(area);
      await this.notify({ sale_id: sale.sale_id, url: `/operations/sales/${encodeURIComponent(sale.sale_id)}`, kind: "overdue", to: [...owner, ...this.areaUsers("supervision")], title: `Expediente atrasado en ${AREA_LABEL[area]}`, body: `${who(sale)} pasó su tiempo objetivo (${hours[sale.queue]} h)` });
      sent++;
    }
    return sent;
  }

  // ── Envío ─────────────────────────────────────────────────────────
  async notify(n) {
    const to = [...new Set((n.to || []).filter(Boolean))];
    if (!to.length) return { to: [], pushed: 0 };
    const payload = { title: n.title, body: n.body, kind: n.kind, sale_id: n.sale_id || null, url: n.url || "/operations", at: new Date().toISOString() };
    // Dentro de la página (SSE): sonido y aviso para quien la tenga abierta.
    this.emit("notify", { ...payload, to });
    let pushed = 0;
    const vapidKeys = this.store?.vapid?.();
    if (!vapidKeys) return { to, pushed };
    await Promise.all(to.flatMap(username => this.store.forUser(username).map(async sub => {
      try {
        const res = await this.sendPush(sub, payload, { vapidKeys, subject: this.subject });
        if (res.gone) this.store.remove(username, sub.endpoint);
        else if (res.ok) pushed++;
      } catch (error) { this.logger.warn?.(`Aviso push a ${username} falló:`, error?.message || error); }
    })));
    return { to, pushed };
  }

  start(listSales, intervalMs = 5 * 60 * 1000) {
    const timer = setInterval(() => void this.checkOverdue(listSales()).catch(error => this.logger.error?.("Avisos de atraso:", error?.message || error)), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
