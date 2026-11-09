// Corre la reactivación de prospectos (ver sales/reactivation.js) cada 30 minutos.
// Se enciende y apaga desde Operations (Respuestas de Mia → Reactivación); por seguridad
// empieza APAGADA. Tope diario de envíos, solo de 10:00 a 19:00 (hora de México) y en horario
// de Mia; no escribe si la conversación está asignada a una persona del equipo.
import { nextReactivation } from "../sales/reactivation.js";
import { templateByName } from "../chatwoot/template-catalog.js";
import { stopLabels } from "../chatwoot/labels.js";

const PAUSE_LABEL = "pausar_mia";

const MX_OFFSET_MS = 6 * 3600 * 1000;
const mxHour = now => new Date(now.getTime() - MX_OFFSET_MS).getUTCHours();
const mxDay = now => new Date(now.getTime() - MX_OFFSET_MS).toISOString().slice(0, 10);

export class ReactivationService {
  constructor({ memories, inspectorEvents, templates, chatwoot, settings, miaAgentId = null, isOpen = () => true, perTick = 25 }) {
    Object.assign(this, { memories, inspectorEvents, templates, chatwoot, settings, miaAgentId, isOpen, perTick });
  }

  config() { return this.settings?.reactivation?.() || { enabled: false, daily_cap: 100 }; }

  lastCustomerAt(id) {
    const events = this.inspectorEvents?.get?.(id) || [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.details?.customer_text || e.details?.customer_at) return e.details?.customer_at || e.timestamp;
    }
    return null;
  }

  sentToday(now = new Date()) {
    const day = mxDay(now);
    let n = 0;
    for (const memory of this.memories.list?.() || []) {
      for (const s of memory.reactivation?.sent || []) if (String(s.at || "").length && mxDay(new Date(s.at)) === day) n++;
      if (memory.reactivation?.docs_reminder_at && mxDay(new Date(memory.reactivation.docs_reminder_at)) === day) n++;
    }
    return n;
  }

  // Lista de lo que se mandaría ahora (también para la vista previa en Operations).
  plan(now = new Date()) {
    const out = [];
    for (const memory of this.memories.list?.() || []) {
      const next = nextReactivation(memory, { lastCustomerAt: this.lastCustomerAt(memory.id), now });
      if (next) out.push({ id: Number(memory.id), name: memory.nombre || null, ...next });
    }
    return out;
  }

  async tick(now = new Date()) {
    const cfg = this.config();
    if (this.running || !cfg.enabled || !this.isOpen(now)) return { sent: 0, reason: cfg.enabled ? "closed" : "disabled" };
    const hour = mxHour(now);
    if (hour < 10 || hour >= 19) return { sent: 0, reason: "hours" };
    this.running = true;
    let sent = 0;
    try {
      let budget = Math.max(0, Math.min(this.perTick, Number(cfg.daily_cap || 0) - this.sentToday(now)));
      for (const item of this.plan(now)) {
        if (budget <= 0) break;
        const id = item.id;
        try {
          // No escribir encima de una persona del equipo.
          const conversation = await this.chatwoot.getConversation(id);
          const assignee = conversation?.meta?.assignee?.id;
          if (assignee && this.miaAgentId && Number(assignee) !== Number(this.miaAgentId)) continue;
          // Si Mia no le va a contestar (etiqueta de cierre como validacion/venta/cerrado, o pausar_mia), no se le
          // escribe (9-nov: clientes contestaron "¿me explica los planes?" y nadie les respondió).
          const labels = (conversation?.labels || []).map(l => typeof l === "string" ? l : l?.title).filter(Boolean);
          const blocked = labels.find(l => stopLabels.has(l) || l === PAUSE_LABEL);
          if (blocked) {
            const memory = this.memories.get(id) || {};
            await this.memories.merge(id, { reactivation: { ...(memory.reactivation || {}), blocked_at: now.toISOString(), blocked_label: blocked } });
            continue;
          }
          const result = await this.templates.sendNamed(id, item.template);
          if (!result.sent) { await this.inspectorEvents?.record?.(id, "reactivation_failed", { template: item.template, reason: result.reason }); continue; }
          const memory = this.memories.get(id) || {};
          const state = memory.reactivation || {};
          const at = now.toISOString();
          const text = templateByName(item.template)?.text || "";
          const patch = item.kind === "documents"
            ? { reactivation: { ...state, docs_reminder_at: at } }
            : { reactivation: { ...state, sent: [...(state.sent || []), { step: item.step, template: item.template, at }], awaiting_reply: true } };
          await this.memories.merge(id, { ...patch, ultima_respuesta_agente: text, ultima_pregunta: null });
          await this.inspectorEvents?.record?.(id, "reactivation_sent", { template: item.template, step: item.step || null, kind: item.kind, reason: item.reason, text });
          sent++; budget--;
        } catch (error) { console.error(`NEXT reactivación ${id}:`, error?.message || error); }
      }
    } finally { this.running = false; }
    return { sent };
  }

  start(everyMs = 30 * 60 * 1000) {
    this.timer = setInterval(() => this.tick().catch(error => console.error("NEXT reactivación:", error)), everyMs);
    this.timer.unref?.();
  }
}
