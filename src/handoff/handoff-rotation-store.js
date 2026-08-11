import fs from "node:fs";
import path from "node:path";

export class HandoffRotationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { groups: {} };
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        this.state = raw ? JSON.parse(raw) : { groups: {} };
      } else {
        this.persistSync();
      }
      if (!this.state || typeof this.state !== "object") this.state = { groups: {} };
      if (!this.state.groups || typeof this.state.groups !== "object") this.state.groups = {};
    } catch (error) {
      console.error("Error cargando rotación de handoff:", error);
      this.state = { groups: {} };
    }
  }

  persistSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  async persist() {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await fs.promises.rename(tmp, this.filePath);
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async assign({ group, agents, conversationId, reason, assignFn }) {
    const task = this.queue.catch(() => {}).then(async () => {
      if (!group || !Array.isArray(agents) || !agents.length) {
        return { status: "skipped", reason: "no_agents_configured", group: group || null };
      }

      const current = this.state.groups[group] || { next_index: 0, completed_assignments: 0 };
      const index = Math.abs(Number(current.next_index || 0)) % agents.length;
      const agent = agents[index];
      const rotationPosition = index + 1;

      let response;
      try {
        response = await assignFn(agent);
      } catch (error) {
        return {
          status: "failed",
          group,
          agent,
          rotation_position: rotationPosition,
          conversation_id: conversationId,
          reason,
          error: error.message,
        };
      }

      this.state.groups[group] = {
        next_index: (index + 1) % agents.length,
        completed_assignments: Number(current.completed_assignments || 0) + 1,
        last_agent_id: agent.id,
        last_agent_name: agent.name,
        last_conversation_id: Number(conversationId),
        last_assigned_at: new Date().toISOString(),
      };
      await this.persist();

      return {
        status: "completed",
        group,
        agent,
        rotation_position: rotationPosition,
        total_agents: agents.length,
        conversation_id: Number(conversationId),
        reason,
        assigned_at: this.state.groups[group].last_assigned_at,
        response,
      };
    });

    this.queue = task.catch(() => {});
    return task;
  }
}
