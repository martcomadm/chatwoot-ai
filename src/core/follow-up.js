import fs from "node:fs";
import path from "node:path";
import { stopLabels } from "../chatwoot/labels.js";
import { onboardingLabel } from "../operations/onboarding-service.js";

// Seguimiento automático cuando el cliente deja de contestar.
//
// Después de cada respuesta de Mia se programa una serie de recordatorios (por defecto
// a los 20 min, 3 h y 20 h). Si el cliente escribe, la serie se cancela y se vuelve a
// programar con la siguiente respuesta de Mia. Todo ocurre dentro de la ventana de 24 h
// de WhatsApp (contada desde el último mensaje del cliente); al cerrarse la ventana sin
// respuesta, Mia pone la etiqueta "no_contesta" y deja de escribir.

export const DEFAULT_FOLLOW_UP_MINUTES = [20, 180, 1200];
const MINUTE = 60 * 1000;
const WINDOW_MS = 24 * 60 * MINUTE;
const WINDOW_SAFETY_MS = 15 * MINUTE;   // no apurar el último minuto de la ventana
const MIN_GAP_MS = 60 * MINUTE;         // separación mínima entre dos seguimientos
export const NO_RESPONSE_LABEL = "no_contesta";
export const PAUSE_LABEL = "pausar_mia";

export function parseFollowUpMinutes(text) {
  if (!text) return DEFAULT_FOLLOW_UP_MINUTES;
  const values = String(text).split(",").map(v => Number(v.trim()));
  if (!values.length || values.some(v => !Number.isFinite(v) || v <= 0) || values.some((v, i) => i && v <= values[i - 1])) {
    throw new Error(`FOLLOWUP_MINUTES inválido: "${text}" (ejemplo: 20,180,1200)`);
  }
  return values;
}

export class FollowUpStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, "utf8")) || {}; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer la cola de seguimientos:", error.message); }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(id) { return this.data[String(id)] || null; }
  set(id, entry) { this.data[String(id)] = entry; this.persist(); }
  remove(id) { if (this.data[String(id)]) { delete this.data[String(id)]; this.persist(); } }
  list() { return Object.entries(this.data).map(([id, entry]) => ({ ...entry, conversationId: Number(id) })); }
}

function planLabel(plan) { return plan === "plan_2" ? "Plan 2" : plan === "plan_1" ? "Plan 1" : null; }

function currentPlan(memory = {}) {
  const cycle = memory.sales_cycle || {};
  if (cycle.selected_plan || cycle.recommended_plan) return cycle.selected_plan || cycle.recommended_plan;
  if (memory.commercial_need?.afore_infonavit) return "plan_2";
  return null;
}

// Mensaje según dónde se quedó la conversación. null = no corresponde dar seguimiento.
export function followUpMessage(memory = {}, step = 0) {
  const authorized = Boolean(memory.sales_cycle?.authorized);
  if (authorized) {
    const ops = memory.operations || {};
    if (ops.documents_complete) return null; // ya lo atiende el equipo de Operaciones
    const key = ops.onboarding_next || ops.documents_missing?.[0] || null;
    const doc = key ? `tu ${onboardingLabel(key)}` : "la documentación pendiente";
    return [
      `¿Pudiste conseguir ${doc}? Cuando la tengas, envíamela por aquí y seguimos con tu trámite.`,
      `Te recuerdo que tu expediente sigue abierto. Solo falta ${doc} para continuar; si tienes alguna dificultad para conseguirla, dime y te ayudo.`,
      `Tu trámite sigue pendiente de ${doc}. Cuando la tengas a la mano, envíamela por aquí y continuamos sin problema.`,
    ][Math.min(step, 2)];
  }
  const plan = planLabel(currentPlan(memory));
  if (plan) {
    return [
      `¿Te quedó alguna duda sobre el ${plan}? Con gusto te la resuelvo.`,
      `Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el ${plan}? Si tienes alguna duda, con gusto te la resuelvo.`,
      `Te escribo para saber si aún te interesa el ${plan}. Si quieres iniciar o tienes alguna pregunta, aquí estoy para ayudarte.`,
    ][Math.min(step, 2)];
  }
  return [
    "¿Sigues por aquí? Con gusto te ayudo a revisar qué plan se ajusta mejor a lo que buscas.",
    "Hola de nuevo. Si te interesa contar con servicio médico del IMSS y seguir cotizando semanas, puedo explicarte las opciones en un momento. ¿Te gustaría?",
    "Te escribo para saber si aún te interesa la información. Si más adelante quieres retomarla, aquí estaré para ayudarte.",
  ][Math.min(step, 2)];
}

function labelNames(conversation) {
  const raw = conversation?.labels || conversation?.meta?.labels || [];
  return raw.map(label => (typeof label === "string" ? label : label?.title || label?.name)).filter(Boolean);
}

function publicMessages(conversation) {
  const list = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return list.filter(m => m && m.private !== true && [0, 1, "incoming", "outgoing"].includes(m.message_type))
    .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
}

const isIncoming = m => m?.message_type === 0 || m?.message_type === "incoming";

export class FollowUpService {
  constructor({ store, chatwoot, labels, memories, config, inspectorEvents = null, isOpen = () => true, isMiaPaused = () => false, minutes = DEFAULT_FOLLOW_UP_MINUTES, sentTexts = new Set() }) {
    this.store = store;
    this.chatwoot = chatwoot;
    this.labels = labels;
    this.memories = memories;
    this.config = config;
    this.inspectorEvents = inspectorEvents;
    this.isOpen = isOpen;
    this.isMiaPaused = isMiaPaused;
    this.offsets = minutes.map(m => m * MINUTE);
    this.sentTexts = sentTexts; // textos que manda Mia mientras espera (p.ej. aviso de horario)
    this.running = false;
  }

  async record(id, type, data) {
    try { await this.inspectorEvents?.record?.(id, type, data); } catch {}
  }

  // Mia acaba de contestar: empieza (o reinicia) la serie de seguimientos.
  afterReply(conversationId, { customerAt = new Date(), now = new Date(), reply = "" } = {}) {
    const texts = reply ? [String(reply).replace(/\s+/g, " ").trim()] : [];
    this.store.set(conversationId, { mia_at: now.toISOString(), customer_at: new Date(customerAt).toISOString(), sent: 0, last_sent_at: null, texts });
  }

  // El cliente escribió: se cancela lo pendiente.
  customerWrote(conversationId) { this.store.remove(conversationId); }

  // Cancelación explícita (rechazo, handoff, pausa por paciencia…).
  cancel(conversationId) { this.store.remove(conversationId); }

  dueAt(entry) {
    const step = Number(entry.sent || 0);
    if (step >= this.offsets.length) return null;
    const base = Date.parse(entry.mia_at) + this.offsets[step];
    const gap = entry.last_sent_at ? Date.parse(entry.last_sent_at) + MIN_GAP_MS : 0;
    return Math.max(base, gap);
  }

  windowEnd(entry) { return Date.parse(entry.customer_at) + WINDOW_MS - WINDOW_SAFETY_MS; }

  // ¿Sigue siendo un chat que Mia debe atender? Devuelve el motivo si no.
  ineligible(conversation, entry) {
    if (Number(conversation?.inbox_id || conversation?.inbox?.id) !== Number(this.config.chatwoot.inboxId)) return "other_inbox";
    const assignee = Number(conversation?.meta?.assignee?.id || conversation?.assignee?.id || 0);
    if (assignee && assignee !== Number(this.config.chatwoot.agentId)) return "reassigned";
    if (["resolved", "closed"].includes(String(conversation?.status || "").toLowerCase())) return "closed";
    const labels = labelNames(conversation);
    if (labels.includes(PAUSE_LABEL)) return "paused_label";
    if (labels.some(label => stopLabels.has(label))) return "stop_label";
    const messages = publicMessages(conversation);
    const last = messages.at(-1);
    if (last && isIncoming(last)) return "customer_wrote";
    const since = Date.parse(entry.mia_at) / 1000 - 5;
    const ignored = new Set([...this.sentTexts].map(t => String(t).replace(/\s+/g, " ").trim()));
    const humanReplied = messages.some(m => !isIncoming(m)
      && Number(m.created_at || 0) >= since
      && String(m.sender_type || m.sender?.type || "").toLowerCase() === "user"
      && Number(m.sender_id || m.sender?.id || 0) !== Number(this.config.chatwoot.agentId)
      && !ignored.has(String(m.content || "").replace(/\s+/g, " ").trim())
      && !(entry.texts || []).includes(String(m.content || "").replace(/\s+/g, " ").trim()));
    if (humanReplied) return "human_replied";
    return null;
  }

  async tick(now = new Date()) {
    if (this.running || this.isMiaPaused()) return { sent: 0 };
    this.running = true;
    let sent = 0;
    try {
      for (const entry of this.store.list()) {
        const id = entry.conversationId;
        const windowClosed = now.getTime() > this.windowEnd(entry);
        const due = this.dueAt(entry);
        if (!windowClosed && (due === null || now.getTime() < due || !this.isOpen(now))) continue;

        let conversation;
        try { conversation = await this.chatwoot.getConversation(id); }
        catch (error) { await this.record(id, "followup_error", { error: String(error?.message || error).slice(0, 300) }); continue; }
        const reason = this.ineligible(conversation, entry);
        if (reason) { this.store.remove(id); await this.record(id, "followup_cancelled", { reason }); continue; }

        if (windowClosed) {
          // Se cerró la ventana de 24 h sin respuesta: etiqueta y fin de la serie.
          this.store.remove(id);
          if (Number(entry.sent || 0) > 0) {
            await this.labels.mergeSafe(id, [NO_RESPONSE_LABEL], [], conversation);
            await this.record(id, "followup_no_response", { sent: entry.sent });
          }
          continue;
        }

        const memory = this.memories.get(id);
        const text = followUpMessage(memory, Number(entry.sent || 0));
        if (!text) { this.store.remove(id); await this.record(id, "followup_cancelled", { reason: "not_applicable" }); continue; }
        await this.chatwoot.sendMessage(id, text);
        await this.memories.set(id, { ...memory, ultima_respuesta_agente: text, ultima_pregunta: null });
        const { conversationId: _omit, ...stored } = entry;
        this.store.set(id, { ...stored, sent: Number(entry.sent || 0) + 1, last_sent_at: now.toISOString(), texts: [...(entry.texts || []), text.replace(/\s+/g, " ").trim()] });
        await this.record(id, "followup_sent", { step: Number(entry.sent || 0) + 1, text });
        sent++;
      }
    } finally { this.running = false; }
    return { sent };
  }

  start(intervalMs = 60_000) {
    const timer = setInterval(() => void this.tick().catch(error => console.error("NEXT seguimientos:", error?.message || error)), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
