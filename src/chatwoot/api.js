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
  getLabels(id) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/labels`); }
  setLabels(id, labels) { return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/labels`, { method: "POST", body: JSON.stringify({ labels }) }); }
  sendMessage(id, content, isPrivate = false) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/messages`, {
      method: "POST", body: JSON.stringify({ content, message_type: "outgoing", private: isPrivate }),
    });
  }
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
