// Plantillas aprobadas de WhatsApp (Twilio Content) enviadas a través de Chatwoot.
//
// Fuera de la ventana de 24 h de WhatsApp (contada desde el último mensaje del cliente)
// solo se puede escribir con una plantilla aprobada. Chatwoot las envía si el mensaje
// lleva `template_params` con el nombre y el idioma de una plantilla sincronizada en el
// inbox. El nombre y el idioma exactos se leen del inbox (content_templates), así no
// depende de adivinar el código de idioma ("es_MX", "es"…).

export const TEMPLATE_TEXTS = Object.freeze({
  validity: "¡Buen día!\nAgradecemos su paciencia y confianza.\nLe informo que usted ya cuenta con vigencia de manera exitosa en sistema.\n\nAyúdeme confirmando, para que le pueda hacer llegar su archivo de Vigencia de Derechos.\nPor favor, muchas gracias.",
  referral: "Si algún familiar o conocido necesita afiliación al IMSS, puedes compartirle mi contacto.\nCon gusto lo apoyamos.",
  followUp24h: "Hola, buen día.\nSi aún estás interesado en afiliarte al IMSS, con gusto puedo ayudarte a iniciar tu proceso.",
});

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WINDOW_SAFETY_MS = 15 * 60 * 1000;

const isIncoming = m => m && m.private !== true && (m.message_type === 0 || m.message_type === "incoming");

// ¿Se puede escribir texto libre? Chatwoot lo calcula (can_reply); si no viene, se usa
// el último mensaje del cliente.
export function replyWindowOpen(conversation, now = Date.now()) {
  if (typeof conversation?.can_reply === "boolean") return conversation.can_reply;
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const last = Math.max(0, ...messages.filter(isIncoming).map(m => Number(m.created_at || 0)));
  return last > 0 && now - last * 1000 < WINDOW_MS - WINDOW_SAFETY_MS;
}

export class WhatsAppTemplates {
  constructor({ chatwoot, inboxId, names = {}, cacheMs = 10 * 60 * 1000 }) {
    this.chatwoot = chatwoot;
    this.inboxId = inboxId;
    this.names = names;
    this.cacheMs = cacheMs;
    this.cache = null;
  }

  enabled(key) { return Boolean(String(this.names?.[key] || "").trim()); }

  async catalog() {
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) return this.cache.list;
    const inbox = await this.chatwoot.getInbox(this.inboxId);
    const list = Array.isArray(inbox?.content_templates?.templates) ? inbox.content_templates.templates : [];
    this.cache = { at: Date.now(), list };
    return list;
  }

  async find(key) {
    const name = String(this.names?.[key] || "").trim();
    if (!name) return null;
    const list = await this.catalog();
    return list.find(t => t?.friendly_name === name && String(t?.status || "").toLowerCase() === "approved") || null;
  }

  // { sent: true, name } o { sent: false, reason }
  async send(conversationId, key) {
    if (!this.enabled(key)) return { sent: false, reason: "disabled" };
    let template;
    try { template = await this.find(key); }
    catch (error) { return { sent: false, reason: "catalog_error", error: String(error?.message || error).slice(0, 200) }; }
    if (!template) return { sent: false, reason: "template_not_synced", name: this.names[key] };
    try {
      await this.chatwoot.sendTemplate(conversationId, {
        content: template.body || TEMPLATE_TEXTS[key] || "",
        name: template.friendly_name,
        language: template.language,
        category: template.category,
      });
    } catch (error) {
      return { sent: false, reason: "send_error", error: String(error?.message || error).slice(0, 200) };
    }
    return { sent: true, name: template.friendly_name };
  }
}
