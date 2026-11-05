// "Preguntas que Mia no supo" (pedido 4-nov, punto 2 de aprendizaje).
// En los chats que pasaron a una persona (handoff, intervención de Captura o venta en Atención),
// se busca en Chatwoot qué preguntó el cliente y qué le contestó la persona del equipo. Supervisión
// revisa la lista y, con un clic, convierte la respuesta de la persona en respuesta de Mia.
import fs from "node:fs";
import path from "node:path";
import { isIncoming } from "../utils/conversation.js";

const DAY = 24 * 3600 * 1000;
const isOutgoing = m => m?.message_type === "outgoing" || m?.message_type === 1;
const isTemplate = m => Boolean(m?.content_attributes?.template_params || m?.additional_attributes?.template_params);
const words = t => String(t || "").trim().split(/\s+/).filter(Boolean).length;

// Datos personales o de pago que no deben convertirse en respuesta de Mia.
const PRIVATE_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b|\b\d{11}\b|\b\d{16,18}\b|clabe|n[uú]mero de cuenta|tarjeta/i;

// Pares pregunta del cliente → primera respuesta pública de una persona del equipo.
export function extractPairs(messages = [], { isOwn = () => false } = {}) {
  const sorted = [...messages].filter(m => m && m.id != null).sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
  const pairs = [];
  let pending = [];
  for (const m of sorted) {
    if (m.private) continue;
    if (isIncoming(m)) { const text = String(m.content || "").trim(); if (text) pending.push(text); continue; }
    if (!isOutgoing(m)) continue;
    const human = !isOwn(m) && String(m.sender?.type || m.sender_type || "user").toLowerCase() !== "agent_bot" && !isTemplate(m);
    if (!human) { pending = []; continue; }
    const answer = String(m.content || "").trim();
    const question = pending.join("\n").trim();
    pending = [];
    if (!question || !answer) continue;
    if (words(question) < 3 && !/\?/.test(question)) continue;
    if (answer.length < 25 || PRIVATE_RE.test(answer)) continue;
    pairs.push({ message_id: String(m.id), question: question.slice(0, 600), answer: answer.slice(0, 900), by: m.sender?.name || null, at: m.created_at ? new Date(Number(m.created_at) * 1000).toISOString() : null });
  }
  return pairs;
}

export class LearningInbox {
  constructor({ file, memories, chatwoot, selfSenders = null, days = 14, maxConversations = 60 }) {
    Object.assign(this, { file, memories, chatwoot, selfSenders, days, maxConversations });
    this.state = { items: [], scanned: {} };
    try { this.state = { items: [], scanned: {}, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudo leer preguntas para aprender:", error.message); }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  candidates(now = new Date()) {
    const since = now.getTime() - this.days * DAY;
    return (this.memories.list?.() || [])
      .filter(m => (m.handoff?.status || m.capture_intervention || m.service_sale) && Date.parse(m.actualizado_en || m.raw_actualizado_en || 0) >= since)
      .filter(m => this.state.scanned[m.id] !== (m.actualizado_en || m.raw_actualizado_en))
      .slice(0, this.maxConversations);
  }

  async scan(now = new Date()) {
    if (this.running || !this.chatwoot?.getAllMessages) return { added: 0 };
    this.running = true;
    let added = 0;
    try {
      const list = this.candidates(now);
      for (let i = 0; i < list.length; i += 3) {
        await Promise.all(list.slice(i, i + 3).map(async memory => {
          try {
            const raw = await this.chatwoot.getAllMessages(memory.id);
            const messages = Array.isArray(raw?.payload) ? raw.payload : [];
            const known = new Set(this.state.items.map(item => `${item.conversation_id}:${item.message_id}`));
            for (const pair of extractPairs(messages, { isOwn: m => Boolean(this.selfSenders?.isOwn?.(m)) })) {
              if (known.has(`${memory.id}:${pair.message_id}`)) continue;
              this.state.items.push({ id: `${memory.id}:${pair.message_id}`, conversation_id: memory.id, customer_name: memory.nombre || null, ...pair, status: "open", found_at: now.toISOString() });
              added++;
            }
            this.state.scanned[memory.id] = memory.actualizado_en || memory.raw_actualizado_en;
          } catch (error) { console.error(`NEXT preguntas para aprender ${memory.id}:`, error?.message || error); }
        }));
      }
      // Solo se guardan los últimos 500 pendientes / 500 resueltos.
      const open = this.state.items.filter(i => i.status === "open").slice(-500);
      const done = this.state.items.filter(i => i.status !== "open").slice(-500);
      this.state.items = [...done, ...open];
      this.persist();
    } finally { this.running = false; }
    return { added };
  }

  list({ status = "open" } = {}) {
    return this.state.items.filter(i => status === "all" || i.status === status).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }

  resolve(id, status, by, answerId = null) {
    const item = this.state.items.find(i => i.id === id);
    if (!item) throw new Error("No existe esa pregunta");
    Object.assign(item, { status, resolved_by: by, resolved_at: new Date().toISOString(), team_answer_id: answerId });
    this.persist();
    return { ...item };
  }

  start(everyMs = 30 * 60 * 1000) {
    this.timer = setInterval(() => this.scan().catch(error => console.error("NEXT preguntas para aprender:", error)), everyMs);
    this.timer.unref?.();
    setTimeout(() => this.scan().catch(() => {}), 60 * 1000).unref?.();
  }
}
