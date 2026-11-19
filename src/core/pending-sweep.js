// Rescate de chats pendientes.
//
// Revisa en Chatwoot las conversaciones abiertas de Mia y retoma las que se quedaron
// sin respuesta: el último mensaje es el aviso de fuera de horario, o un mensaje del
// cliente que Mia nunca procesó (por ejemplo, porque NEXT se reinició o se redesplegó
// en ese momento). Así un chat no depende solo de la cola en disco para ser atendido.

const MINUTE = 60 * 1000;
const NOTICE_RE = /^¡Gracias por escribir a MARTCOM! Nuestro horario de atención es/;
const isIncoming = m => m?.message_type === 0 || m?.message_type === "incoming";
const isOutgoing = m => m?.message_type === 1 || m?.message_type === "outgoing";
const createdMs = m => Number(m?.created_at || 0) * 1000;

function payloadOf(response) {
  if (Array.isArray(response?.data?.payload)) return response.data.payload;
  if (Array.isArray(response?.payload)) return response.payload;
  if (Array.isArray(response)) return response;
  return [];
}

// Qué mensajes del cliente quedaron sin atender. null si no hay nada que retomar.
export function pendingFromMessages(messages, { selfSenders, now = Date.now(), minAgeMs = 5 * MINUTE, windowMs = 23 * 60 * MINUTE } = {}) {
  const list = (messages || []).filter(m => m && m.private !== true && (isIncoming(m) || isOutgoing(m)))
    .sort((a, b) => createdMs(a) - createdMs(b));
  const last = list.at(-1);
  if (!last) return null;
  const notice = m => isOutgoing(m) && NOTICE_RE.test(String(m.content || "").trim());
  // Última respuesta real (de Mia o de una persona), sin contar el aviso de horario.
  let lastReplyIndex = -1;
  for (let i = list.length - 1; i >= 0; i--) if (isOutgoing(list[i]) && !notice(list[i])) { lastReplyIndex = i; break; }
  const lastReply = list[lastReplyIndex];
  // Si quien contestó al último fue una persona del equipo, el chat es suyo.
  if (lastReply && !selfSenders?.isOwn?.(lastReply)) return null;
  const pending = list.slice(lastReplyIndex + 1).filter(isIncoming);
  if (!pending.length) return null;
  const newest = pending.at(-1);
  if (now - createdMs(newest) > windowMs) return null;         // fuera de la ventana de WhatsApp
  if (isIncoming(last) && now - createdMs(last) < minAgeMs) return null; // aún lo está atendiendo el flujo normal
  return { kind: notice(last) ? "after_hours_notice" : "unanswered", ids: pending.map(m => String(m.id)), firstAt: new Date(createdMs(pending[0])) };
}

export class PendingSweep {
  constructor({ chatwoot, config, afterHours, memories, selfSenders, turnLock = null, wake, isOpen = () => true, isMiaPaused = () => false, inspectorEvents = null, maxPages = 8 }) {
    Object.assign(this, { chatwoot, config, afterHours, memories, selfSenders, turnLock, wake, isOpen, isMiaPaused, inspectorEvents, maxPages });
    this.running = false;
  }

  async record(id, type, data) { try { await this.inspectorEvents?.record?.(id, type, data); } catch {} }

  async candidates() {
    const out = [];
    for (let page = 1; page <= this.maxPages; page++) {
      const items = payloadOf(await this.chatwoot.listConversations({ inboxId: this.config.chatwoot.inboxId, page }));
      for (const c of items) {
        const assignee = Number(c?.meta?.assignee?.id || c?.assignee_id || 0);
        if (Number(c?.inbox_id) !== Number(this.config.chatwoot.inboxId)) continue;
        if (assignee !== Number(this.config.chatwoot.agentId)) continue;
        out.push(c);
      }
      if (items.length < 25) break;
    }
    return out;
  }

  async run(now = Date.now()) {
    if (this.running || !this.isOpen(new Date(now)) || this.isMiaPaused()) return { resumed: 0 };
    this.running = true;
    let resumed = 0;
    try {
      for (const conversation of await this.candidates()) {
        const id = Number(conversation.id);
        if (this.afterHours.has(id)) continue;
        let messages;
        try { messages = payloadOf(await this.chatwoot.getMessages(id)); }
        catch (error) { await this.record(id, "pending_sweep_error", { error: String(error?.message || error).slice(0, 300) }); continue; }
        const pending = pendingFromMessages(messages, { selfSenders: this.selfSenders, now });
        if (!pending) continue;
        // Mensajes que Mia nunca vio se retoman normal; los que quedaron tras el aviso, aunque figuren como procesados.
        const force = pending.kind === "after_hours_notice";
        if (!force && pending.ids.every(mid => this.memories.hasProcessed(id, mid))) continue;
        // Un intento por mensaje: si Mia decide no contestar, no se vuelve a intentar cada vez.
        if (this.turnLock && !this.turnLock.claim(id, [`rescate-${pending.ids.at(-1)}`])) continue;
        this.afterHours.add(id, pending.ids, pending.firstAt, { force });
        await this.record(id, "pending_sweep_resumed", { kind: pending.kind, message_ids: pending.ids });
        this.wake(id);
        resumed++;
      }
    } finally { this.running = false; }
    return { resumed };
  }

  start({ firstDelayMs = 30_000, intervalMs = 15 * MINUTE } = {}) {
    const tick = () => void this.run().then(r => { if (r.resumed) console.log(`NEXT: se retomaron ${r.resumed} chats pendientes.`); })
      .catch(error => console.error("NEXT rescate de pendientes:", error?.message || error));
    const first = setTimeout(tick, firstDelayMs); first.unref?.();
    const timer = setInterval(tick, intervalMs); timer.unref?.();
    return () => { clearTimeout(first); clearInterval(timer); };
  }
}
