import fs from "node:fs";
import path from "node:path";

export class AgentRotationStore {
  constructor(filePath, agents) {
    this.filePath = filePath;
    this.agents = agents.filter(Boolean);
    this.state = { next_index: 0 };
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        const parsed = raw ? JSON.parse(raw) : {};
        const index = Number(parsed.next_index);
        this.state.next_index = Number.isInteger(index) && index >= 0 ? index % this.agents.length : 0;
      } else {
        this.persistSync();
      }
    } catch (error) {
      console.error("Error cargando rotación de asesores:", error);
      this.state = { next_index: 0 };
      this.persistSync();
    }
  }

  persistSync() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  async next() {
    this.queue = this.queue.then(async () => {
      if (!this.agents.length) throw new Error("La lista de asesores de presentación está vacía");
      const index = this.state.next_index % this.agents.length;
      const agent = this.agents[index];
      this.state.next_index = (index + 1) % this.agents.length;
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
      await fs.promises.rename(tmp, this.filePath);
      return agent;
    });
    return this.queue;
  }

  snapshot() {
    return { ...this.state, agents: [...this.agents] };
  }
}
