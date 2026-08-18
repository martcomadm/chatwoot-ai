import fs from "node:fs";
import path from "node:path";

function nowIso() { return new Date().toISOString(); }

export class HandoffRotationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { groups: {}, reservations: {} };
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        this.state = raw ? JSON.parse(raw) : { groups: {}, reservations: {} };
      } else {
        this.persistSync();
      }
      if (!this.state || typeof this.state !== "object") this.state = { groups: {}, reservations: {} };
      if (!this.state.groups || typeof this.state.groups !== "object") this.state.groups = {};
      if (!this.state.reservations || typeof this.state.reservations !== "object") this.state.reservations = {};
    } catch (error) {
      console.error("Error cargando rotación de handoff:", error);
      this.state = { groups: {}, reservations: {} };
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

  reservation(conversationId) {
    return this.state.reservations?.[String(conversationId)] || null;
  }

  async reserve({ group, agents, conversationId }) {
    const task = this.queue.catch(() => {}).then(async () => {
      if (!group || !Array.isArray(agents) || !agents.length) {
        return { status: "skipped", reason: "no_agents_configured", group: group || null };
      }

      const key = String(conversationId);
      const existing = this.state.reservations[key];
      if (existing?.agent_id) {
        const configured = agents.find(agent => Number(agent.id) === Number(existing.agent_id));
        return {
          status: "reserved",
          reused: true,
          group: existing.group || group,
          agent: configured || { id: existing.agent_id, name: existing.agent_name },
          rotation_position: existing.rotation_position || null,
          total_agents: existing.total_agents || agents.length,
          reserved_at: existing.reserved_at || null,
          conversation_id: Number(conversationId),
        };
      }

      const current = this.state.groups[group] || { next_index: 0, completed_assignments: 0, total_reservations: 0 };
      const index = Math.abs(Number(current.next_index || 0)) % agents.length;
      const agent = agents[index];
      const reservedAt = nowIso();
      const rotationPosition = index + 1;

      this.state.groups[group] = {
        ...current,
        next_index: (index + 1) % agents.length,
        total_reservations: Number(current.total_reservations || 0) + 1,
        last_reserved_agent_id: agent.id,
        last_reserved_agent_name: agent.name,
        last_reserved_conversation_id: Number(conversationId),
        last_reserved_at: reservedAt,
      };
      this.state.reservations[key] = {
        conversation_id: Number(conversationId),
        group,
        agent_id: agent.id,
        agent_name: agent.name,
        rotation_position: rotationPosition,
        total_agents: agents.length,
        reserved_at: reservedAt,
        status: "reserved",
      };
      await this.persist();

      return {
        status: "reserved",
        reused: false,
        group,
        agent,
        rotation_position: rotationPosition,
        total_agents: agents.length,
        reserved_at: reservedAt,
        conversation_id: Number(conversationId),
      };
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async markAssigned(conversationId, details = {}) {
    const task = this.queue.catch(() => {}).then(async () => {
      const key = String(conversationId);
      const reservation = this.state.reservations[key];
      if (reservation) {
        this.state.reservations[key] = { ...reservation, status: "assigned", assigned_at: details.assigned_at || nowIso() };
      }
      const group = details.group || reservation?.group;
      if (group) {
        const current = this.state.groups[group] || {};
        this.state.groups[group] = {
          ...current,
          completed_assignments: Number(current.completed_assignments || 0) + 1,
          last_agent_id: details.agent_id || reservation?.agent_id || null,
          last_agent_name: details.agent_name || reservation?.agent_name || null,
          last_conversation_id: Number(conversationId),
          last_assigned_at: details.assigned_at || nowIso(),
        };
      }
      await this.persist();
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async assignReserved({ group, agent, conversationId, reason, rotationPosition = null, totalAgents = null, assignFn }) {
    if (!agent?.id) return { status: "skipped", reason: "no_reserved_agent", group: group || null };
    try {
      const response = await assignFn(agent);
      const assignedAt = nowIso();
      await this.markAssigned(conversationId, {
        group,
        agent_id: agent.id,
        agent_name: agent.name,
        assigned_at: assignedAt,
      });
      return {
        status: "completed",
        group,
        agent,
        rotation_position: rotationPosition,
        total_agents: totalAgents,
        conversation_id: Number(conversationId),
        reason,
        assigned_at: assignedAt,
        response,
      };
    } catch (error) {
      return {
        status: "failed",
        group,
        agent,
        rotation_position: rotationPosition,
        total_agents: totalAgents,
        conversation_id: Number(conversationId),
        reason,
        error: error.message,
      };
    }
  }

  // Compatibilidad V3.2.1: reserva primero y asigna al mismo asesor.
  async assign({ group, agents, conversationId, reason, assignFn }) {
    const reserved = await this.reserve({ group, agents, conversationId });
    if (reserved.status !== "reserved") return reserved;
    return this.assignReserved({
      group: reserved.group,
      agent: reserved.agent,
      conversationId,
      reason,
      rotationPosition: reserved.rotation_position,
      totalAgents: reserved.total_agents,
      assignFn,
    });
  }
}
