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
  assignConversation(id, assigneeId) {
    return this.request(`/api/v1/accounts/${this.config.accountId}/conversations/${id}/assignments`, {
      method: "POST", body: JSON.stringify({ assignee_id: Number(assigneeId) }),
    });
  }
}
