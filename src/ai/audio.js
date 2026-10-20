// Notas de voz de WhatsApp: se descargan de Chatwoot y se transcriben con OpenAI para que Mia
// conteste como si el cliente lo hubiera escrito. Máximo 10 minutos (decisión 20-oct).

export const MAX_AUDIO_SECONDS = 10 * 60;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // límite de OpenAI: 25 MB

export function isAudioAttachment(a = {}) {
  return /audio|voice|ogg|opus|mpeg|mp3|m4a|aac|amr|wav|webm/i.test(String(a?.file_type || a?.content_type || a?.extension || ""))
    || /\.(?:ogg|opus|oga|mp3|m4a|aac|amr|wav|webm)(?:\?|$)/i.test(String(a?.file_name || a?.data_url || ""));
}

// Duración exacta de un audio Ogg/Opus (el formato de las notas de voz de WhatsApp): la posición
// granular de la última página / 48 000. null si no es Ogg u Opus.
export function oggOpusSeconds(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (buf.length < 64 || buf.toString("latin1", 0, 4) !== "OggS") return null;
  const head = buf.toString("latin1", 0, Math.min(buf.length, 512));
  const opus = head.includes("OpusHead");
  for (let i = buf.length - 27; i >= 0; i--) {
    if (buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53) {
      const granule = Number(buf.readBigUInt64LE(i + 6));
      if (!Number.isFinite(granule) || granule <= 0) return null;
      if (opus) return granule / 48000;
      // Vorbis: la frecuencia viene en el encabezado de identificación.
      const v = head.indexOf("\u0001vorbis");
      const rate = v >= 0 ? buf.readUInt32LE(v + 12) : 0;
      return rate ? granule / rate : null;
    }
  }
  return null;
}

// { ok: true, text, seconds } | { ok: false, reason: "too_long" | "too_big" | "download_failed" | "empty" | "error", seconds? }
export async function transcribeAudioAttachment(openai, attachment, { model = "gpt-4o-mini-transcribe", fetchImpl = fetch, maxSeconds = MAX_AUDIO_SECONDS } = {}) {
  const url = attachment?.data_url || attachment?.download_url || attachment?.file_url || attachment?.url;
  if (!url) return { ok: false, reason: "download_failed" };
  let buffer;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return { ok: false, reason: "download_failed" };
    buffer = Buffer.from(await response.arrayBuffer());
  } catch { return { ok: false, reason: "download_failed" }; }
  if (buffer.length > MAX_AUDIO_BYTES) return { ok: false, reason: "too_big" };
  const type = String(attachment?.file_type === "audio" ? "audio/ogg" : attachment?.content_type || attachment?.file_type || "audio/ogg");
  // Ogg/Opus (las notas de voz de WhatsApp) da la duración exacta; en otros formatos se usa la que
  // traiga Chatwoot y, si no viene, se transcribe (el límite de 24 MB evita archivos enormes).
  const seconds = oggOpusSeconds(buffer) ?? (Number(attachment?.meta?.duration) || null);
  if (seconds && seconds > maxSeconds) return { ok: false, reason: "too_long", seconds };
  const ext = /mpeg|mp3/i.test(type) ? "mp3" : /mp4|m4a|aac/i.test(type) ? "m4a" : /wav/i.test(type) ? "wav" : /webm/i.test(type) ? "webm" : "ogg";
  const file = new File([buffer], `nota-de-voz.${ext}`, { type: /\//.test(type) ? type : `audio/${ext}` });
  try {
    // Un audio de 10 min puede tardar más que el tiempo límite normal de la IA (30 s).
    const result = await openai.audio.transcriptions.create({ file, model, language: "es" }, { timeout: 120000 });
    const text = String(result?.text || "").replace(/\s+/g, " ").trim();
    return text ? { ok: true, text, seconds } : { ok: false, reason: "empty", seconds };
  } catch (error) {
    return { ok: false, reason: "error", error: String(error?.message || error).slice(0, 200), seconds };
  }
}
