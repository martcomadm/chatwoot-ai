function numberOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function assigneeIdOf(payload = {}) {
  const conversation = payload?.conversation || payload?.message?.conversation || payload;
  return numberOf(
    conversation?.meta?.assignee?.id ??
    conversation?.assignee?.id ??
    payload?.meta?.assignee?.id ??
    payload?.assignee?.id ??
    payload?.message?.conversation?.meta?.assignee?.id ??
    payload?.message?.conversation?.assignee?.id
  );
}

export function webhookEventAllowedForAgent(payload, expectedAgentId) {
  const expected = numberOf(expectedAgentId);
  if (!expected) return false;
  return assigneeIdOf(payload) === expected;
}
