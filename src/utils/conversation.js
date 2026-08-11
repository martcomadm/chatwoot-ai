export const arrays = (a = [], b = [], max = 100) => [...new Set([...(a || []), ...(b || [])])].slice(-max);
export const messageOf = payload => payload?.message || payload;
export const conversationIdOf = payload => Number(payload?.conversation?.id ?? payload?.message?.conversation_id ?? payload?.conversation_id ?? payload?.id);
export const inboxIdOf = payload => Number(payload?.conversation?.inbox_id ?? payload?.conversation?.inbox?.id ?? payload?.inbox?.id ?? payload?.message?.inbox_id);
export const isIncoming = message => message?.message_type === "incoming" || message?.message_type === 0;
export const isContact = message => {
  const type = String(message?.sender_type || message?.sender?.type || "").toLowerCase();
  return !type || type === "contact";
};
export const hasAttachments = message => Array.isArray(message?.attachments) && message.attachments.length > 0;

export function messagesOf(conversation) {
  for (const candidate of [conversation?.messages, conversation?.payload?.messages, conversation?.conversation?.messages]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function historyOf(conversation, maxHistory = 50) {
  return messagesOf(conversation)
    .filter(message => !message.private && message.content)
    .slice(-maxHistory)
    .map(message => `${isIncoming(message) ? "CLIENTE" : "AGENTE"}: ${String(message.content).trim()}`)
    .join("\n");
}

export function localHour(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour")?.value || 0);
}
