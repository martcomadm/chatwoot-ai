// Mensajes de Chatwoot → conversación de solo lectura para Operaciones (expediente y Chats de Mia).
// includeNotes (26-nov): Operaciones muestra todas las notas internas con su autor, en todas las áreas.
// Sin includeNotes solo pasa la transcripción de notas de voz.
const VOICE_NOTE_RE = /^🎤 Transcripción/;

export function toConversationItems(list, { customerName = null, teamTexts = new Map(), isOwn = null, agentId = null, includeNotes = false } = {}) {
  return (Array.isArray(list) ? list : [])
    .filter(m => m && [0, 1, "incoming", "outgoing"].includes(m.message_type))
    .filter(m => m.private !== true || includeNotes || VOICE_NOTE_RE.test(String(m.content || "")))
    .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
    .slice(-300)
    .map(m => {
      const incoming = m.message_type === 0 || m.message_type === "incoming";
      const own = !incoming && (Boolean(isOwn?.(m)) || Number(m.sender_id || m.sender?.id || 0) === Number(agentId ?? -1));
      const text = String(m.content || "");
      const name = incoming ? (customerName || "Cliente")
        : m.private ? (own ? "Mia" : m.sender?.name || "Equipo")
        : own ? (teamTexts.has(text.trim()) ? `${teamTexts.get(text.trim())} (desde Mia)` : "Mia")
        : (m.sender?.name || "Equipo");
      return {
        id: String(m.id),
        who: m.private ? "nota" : incoming ? "cliente" : own ? "mia" : "persona",
        name,
        text,
        at: new Date(Number(m.created_at || 0) * 1000).toISOString(),
        attachments: (m.attachments || []).map(a => ({ type: String(a.file_type || "").toLowerCase(), url: a.data_url || a.file_url || null, thumb: a.thumb_url || null, name: a.file_name || a.fallback_title || null })).filter(a => a.url),
      };
    });
}
