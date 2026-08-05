import fs from "node:fs";
import path from "node:path";

export class InspectorEventStore {
  constructor(filePath, maxPerConversation = 200) {
    this.filePath = filePath;
    this.maxPerConversation = maxPerConversation;
    this.data = {};
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        this.data = raw ? JSON.parse(raw) : {};
      } else {
        this.persistSync();
      }
    } catch (error) {
      console.error("Inspector: no se pudo cargar timeline:", error);
      this.data = {};
    }
  }

  persistSync() {
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(temp, this.filePath);
  }

  async persist() {
    this.queue = this.queue.then(async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(temp, JSON.stringify(this.data, null, 2), "utf8");
      await fs.promises.rename(temp, this.filePath);
    });
    return this.queue;
  }

  async record(conversationId, type, details = {}) {
    const key = String(conversationId);
    const events = Array.isArray(this.data[key]) ? this.data[key] : [];
    events.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      type,
      details,
    });
    this.data[key] = events.slice(-this.maxPerConversation);
    await this.persist();
  }

  get(conversationId) {
    return Array.isArray(this.data[String(conversationId)])
      ? structuredClone(this.data[String(conversationId)])
      : [];
  }

  listConversationIds() {
    return Object.keys(this.data)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
  }
}
