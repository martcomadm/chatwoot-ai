// Calificar respuestas de Mia desde "Chats de Mia" (pedido 4-nov, punto 3 de aprendizaje).
// 👍 / 👎 en cada mensaje de Mia; el 👎 lleva "así debió contestar". Las correcciones recientes
// entran a las instrucciones de la IA como ejemplos y Supervisión puede convertirlas en
// respuesta del equipo (texto fijo) desde "Respuestas de Mia".
import fs from "node:fs";
import path from "node:path";

const MAX_EXAMPLES = 25;

export class ReplyFeedbackStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    try { if (file) this.items = JSON.parse(fs.readFileSync(file, "utf8"))?.items || []; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudieron leer las calificaciones:", error.message); }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items: this.items.slice(-3000) }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  rate({ conversationId, messageId, rating, correction = "", note = "", miaText = "", customerText = "", user = {} }) {
    if (!["up", "down"].includes(rating)) throw new Error("Calificación no válida");
    const fix = String(correction || "").trim();
    if (rating === "down" && fix.length < 10) throw new Error("Escribe cómo debió contestar Mia");
    if (fix.length > 900) throw new Error("La corrección es muy larga (máximo 900 caracteres)");
    const id = `${Number(conversationId)}:${String(messageId)}`;
    const existing = this.items.find(item => item.id === id);
    const item = {
      id, conversation_id: Number(conversationId), message_id: String(messageId),
      rating, correction: rating === "down" ? fix : null, note: String(note || "").trim().slice(0, 300) || null,
      mia_text: String(miaText || "").slice(0, 900), customer_text: String(customerText || "").slice(0, 600),
      by: user.name || user.username || null, username: user.username || null,
      at: new Date().toISOString(), status: rating === "down" ? "open" : "ok",
    };
    if (existing) Object.assign(existing, item); else this.items.push(item);
    this.persist();
    return { ...item };
  }

  forConversation(conversationId) {
    const out = {};
    for (const item of this.items) if (item.conversation_id === Number(conversationId)) out[item.message_id] = { rating: item.rating, correction: item.correction, by: item.by };
    return out;
  }

  list({ status = "open" } = {}) {
    return this.items.filter(item => item.rating === "down" && (status === "all" || item.status === status)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  stats({ days = 30, now = new Date() } = {}) {
    const since = now.getTime() - days * 24 * 3600 * 1000;
    const recent = this.items.filter(item => Date.parse(item.at) >= since);
    const up = recent.filter(item => item.rating === "up").length;
    const down = recent.filter(item => item.rating === "down").length;
    return { up, down, total: up + down, approval: up + down ? Math.round((up / (up + down)) * 100) : null, open: this.list().length };
  }

  resolve(id, status, by, answerId = null) {
    const item = this.items.find(i => i.id === id);
    if (!item) throw new Error("No existe esa calificación");
    Object.assign(item, { status, resolved_by: by, resolved_at: new Date().toISOString(), team_answer_id: answerId });
    this.persist();
    return { ...item };
  }

  // Correcciones recientes (no archivadas) como ejemplos para la IA.
  promptBlock() {
    const examples = this.items.filter(item => item.rating === "down" && item.correction && item.status !== "archived").slice(-MAX_EXAMPLES);
    if (!examples.length) return "";
    return [
      "CORRECCIONES DEL EQUIPO A RESPUESTAS ANTERIORES DE MIA (aprende de estos ejemplos: en casos parecidos responde como indica \"Debió decir\", adaptado al cliente, sin copiar datos personales):",
      ...examples.map(item => `- Cliente: ${item.customer_text.replace(/\s+/g, " ").slice(0, 200) || "(sin texto)"}\n  Mia dijo: ${item.mia_text.replace(/\s+/g, " ").slice(0, 200)}\n  Debió decir: ${item.correction.replace(/\s+/g, " ")}`),
    ].join("\n");
  }
}
