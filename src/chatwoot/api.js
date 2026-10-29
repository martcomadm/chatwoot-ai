export class ChatwootApi {
  constructor(config) { this.config = config; }
  async request(path, options = {}) {
    const response = await fetch(this.config.baseUrl + path, {
      ...options,
      headers: { "Content-Type": "application/json", api_access_token: this.config.token, ...(options.headers || {}) },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
    return data;
  }
  getConversation(id) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}`); }
  // Conversaciones abiertas de un inbox (25 por página).
  listConversations({ inboxId, status = "open", page = 1 } = {}) {
    const query = new URLSearchParams({ assignee_type: "all", status, page: String(page), ...(inboxId ? { inbox_id: String(inboxId) } : {}) });
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations?${query}`);
  }
  getMessages(id, { before = null } = {}) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/messages${before ? `?before=${Number(before)}` : ""}`); }
  // Chatwoot entrega los mensajes en páginas de ~20 (los más recientes primero); aquí se
  // juntan todas las páginas para tener la conversación completa.
  async getAllMessages(id, { maxPages = 25 } = {}) {
    const all = new Map();
    let before = null;
    for (let page = 0; page < maxPages; page++) {
      const raw = await this.getMessages(id, { before });
      const list = Array.isArray(raw?.payload) ? raw.payload : Array.isArray(raw) ? raw : [];
      const fresh = list.filter(m => m?.id != null && !all.has(m.id));
      for (const m of fresh) all.set(m.id, m);
      if (!fresh.length || list.length < 20) break;
      before = Math.min(...fresh.map(m => Number(m.id)));
    }
    return { payload: [...all.values()].sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0)) };
  }
  getLabels(id) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/labels`); }
  setLabels(id, labels) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/labels`, { method: "POST", body: JSON.stringify({ labels }) }); }
  sendMessage(id, content, isPrivate = false) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/messages`, {
      method: "POST", body: JSON.stringify({ content, message_type: "outgoing", private: isPrivate }),
    });
  }
  // Plantilla aprobada de WhatsApp (Twilio Content). Chatwoot busca el content_sid por
  // nombre e idioma entre las plantillas sincronizadas del inbox.
  sendTemplate(id, { content, name, language, category = null, params = {} }) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message_type: "outgoing", private: false, template_params: { name, language, ...(category ? { category } : {}), processed_params: params } }),
    });
  }
  getInbox(id) { return this.request(`/api/v1/accounts/${this.config.accountId}/inboxes/${id}`); }
  async sendMessageWithAttachment(id, content, attachment, isPrivate = false) {
    const form = new FormData();
    form.append("content", content || "");
    form.append("message_type", "outgoing");
    form.append("private", String(Boolean(isPrivate)));
    const bytes = Buffer.from(String(attachment?.base64 || ""), "base64");
    form.append("attachments[]", new Blob([bytes], { type: attachment?.contentType || "application/pdf" }), attachment?.filename || "vigencia.pdf");
    const response = await fetch(this.config.baseUrl + `/api/v1/accounts/${this.config.accountId}/conversations/${id}/messages`, {
      method: "POST",
      headers: { api_access_token: this.config.token },
      body: form,
    });
    const responseText = await response.text();
    let data = null;
    try { data = responseText ? JSON.parse(responseText) : null; } catch { data = responseText; }
    if (!response.ok) throw new Error(`Chatwoot ${response.status}: ${JSON.stringify(data)}`);
    return data;
  }
  assignConversation(id, assigneeId) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/assignments`, {
      method: "POST", body: JSON.stringify({ assignee_id: Number(assigneeId) }),
    });
  }
  assignTeam(id, teamId) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/assignments`, {
      method: "POST", body: JSON.stringify({ team_id: Number(teamId) }),
    });
  }
}
