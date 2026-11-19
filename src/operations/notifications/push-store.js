import { readJson, writeJson } from "../access/json-file.js";
import { generateVapidKeys } from "./web-push.js";

// Llaves VAPID, suscripciones de cada persona (una por dispositivo) y avisos ya enviados
// (para no repetir el aviso de atraso del mismo expediente en la misma área).
export class PushStore {
  constructor(file, { publicKey = "", privateKey = "" } = {}) {
    this.file = file;
    this.data = readJson(file, { vapid: null, subscriptions: {}, sent: {} });
    this.data.subscriptions ||= {};
    this.data.sent ||= {};
    if (publicKey && privateKey) this.data.vapid = { publicKey, privateKey };
    if (!this.data.vapid?.publicKey) { this.data.vapid = generateVapidKeys(); this.persist(); }
  }

  persist() { writeJson(this.file, this.data, 0o600); }

  vapid() { return this.data.vapid; }

  add(username, subscription, userAgent = "") {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error("Suscripción inválida");
    if (!/^https:\/\//.test(subscription.endpoint)) throw new Error("Suscripción inválida");
    const list = (this.data.subscriptions[username] || []).filter(s => s.endpoint !== subscription.endpoint);
    list.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, user_agent: String(userAgent || "").slice(0, 160), created_at: new Date().toISOString() });
    this.data.subscriptions[username] = list.slice(-10);
    this.persist();
  }

  remove(username, endpoint) {
    const list = this.data.subscriptions[username] || [];
    const next = list.filter(s => s.endpoint !== endpoint);
    if (next.length !== list.length) { this.data.subscriptions[username] = next; this.persist(); }
  }

  removeEverywhere(endpoint) {
    for (const username of Object.keys(this.data.subscriptions)) this.remove(username, endpoint);
  }

  forUser(username) { return [...(this.data.subscriptions[username] || [])]; }

  // true la primera vez que se marca la clave; false si ya se había enviado.
  markOnce(key) {
    if (this.data.sent[key]) return false;
    this.data.sent[key] = new Date().toISOString();
    // Conservar solo los últimos ~2000 registros.
    const keys = Object.keys(this.data.sent);
    if (keys.length > 2000) for (const old of keys.slice(0, keys.length - 2000)) delete this.data.sent[old];
    this.persist();
    return true;
  }
}
