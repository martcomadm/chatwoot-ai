function weekdayKey(date, timezone) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  if (weekday === "Sat") return "saturday";
  if (weekday === "Sun") return "sunday";
  return "weekday";
}

export class HandoffRouter {
  constructor({ config, store, chatwoot }) {
    this.config = config;
    this.store = store;
    this.chatwoot = chatwoot;
  }

  groupFor(date = new Date()) {
    return weekdayKey(date, this.config.ai.timezone);
  }

  agentsFor(group) {
    if (group === "saturday") return this.config.handoff.saturdayAgents;
    if (group === "sunday") return this.config.handoff.sundayAgents;
    return this.config.handoff.weekdayAgents;
  }

  async route({ conversationId, reason, date = new Date() }) {
    if (!this.config.handoff.enabled) {
      return { status: "skipped", reason: "auto_handoff_disabled", group: this.groupFor(date) };
    }

    const group = this.groupFor(date);
    const agents = this.agentsFor(group);
    if (!agents.length) {
      return { status: "skipped", reason: "no_agents_configured", group };
    }

    return this.store.assign({
      group,
      agents,
      conversationId,
      reason,
      assignFn: async (agent) => {
        const response = await this.chatwoot.assignConversation(conversationId, agent.id);
        const responseId = Number(response?.id);
        if (Number.isFinite(responseId) && responseId !== Number(agent.id)) {
          throw new Error(`Chatwoot confirmó un usuario distinto al esperado: ${responseId}`);
        }
        return response;
      },
    });
  }
}
