import test from "node:test";
import assert from "node:assert/strict";
import { oggOpusSeconds, transcribeAudioAttachment, isAudioAttachment, MAX_AUDIO_SECONDS } from "../src/ai/audio.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";

function oggPage(granule, payload = "") {
  const b = Buffer.alloc(27 + payload.length);
  b.write("OggS", 0, "latin1");
  b.writeBigUInt64LE(BigInt(granule), 6);
  b.write(payload, 27, "latin1");
  return b;
}
const opusOgg = seconds => Buffer.concat([oggPage(0, "OpusHead\u0001\u0001"), Buffer.alloc(200, 1), oggPage(Math.round(seconds * 48000))]);

test("duración exacta de una nota de voz de WhatsApp (Ogg/Opus)", () => {
  assert.equal(Math.round(oggOpusSeconds(opusOgg(42.5)) * 10) / 10, 42.5);
  assert.equal(oggOpusSeconds(Buffer.from("ID3 mp3 data".padEnd(100, "x"))), null);
  assert.ok(isAudioAttachment({ file_type: "audio" }));
  assert.ok(!isAudioAttachment({ file_type: "image" }));
});

test("transcribe hasta 10 min; más largo no se manda a OpenAI", async () => {
  const calls = [];
  const openai = { audio: { transcriptions: { create: async args => { calls.push(args); return { text: " Quiero saber cuánto cuesta el plan uno " }; } } } };
  const fetchOf = buf => async () => ({ ok: true, arrayBuffer: async () => buf });
  const ok = await transcribeAudioAttachment(openai, { file_type: "audio", data_url: "https://chat/a.ogg" }, { fetchImpl: fetchOf(opusOgg(9 * 60)) });
  assert.deepEqual([ok.ok, ok.text], [true, "Quiero saber cuánto cuesta el plan uno"]);
  assert.equal(calls[0].model, "gpt-4o-mini-transcribe");
  assert.equal(calls[0].language, "es");
  assert.ok(calls[0].file instanceof File);
  const long = await transcribeAudioAttachment(openai, { file_type: "audio", data_url: "https://chat/b.ogg" }, { fetchImpl: fetchOf(opusOgg(MAX_AUDIO_SECONDS + 30)) });
  assert.equal(long.reason, "too_long");
  assert.equal(calls.length, 1);
  const down = await transcribeAudioAttachment(openai, { file_type: "audio", data_url: "https://chat/c.ogg" }, { fetchImpl: async () => ({ ok: false }) });
  assert.equal(down.reason, "download_failed");
});

function harness({ ai = {}, memory = { presentacion_realizada: true, ultima_respuesta_agente: "¿Qué buscas principalmente?" } } = {}) {
  const sent = []; const notes = []; const events = []; let mem = structuredClone(memory);
  const m = { id: 990, message_type: 0, content: "", private: false, attachments: [{ id: 1, file_type: "audio", data_url: "https://chat/v.ogg" }], sender: { type: "contact" }, sender_type: "Contact" };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { (priv ? notes : sent).push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, handoffRouter: {}, workflow: null,
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "«LLM»" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "", ...ai },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } },
  });
  return { run: () => p.process(80, { ids: ["990"], webhookMessages: new Map([["990", m]]) }), sent, notes, events };
}

test("Mia contesta la nota de voz como si la hubieran escrito y deja la transcripción en nota privada", async () => {
  const h = harness({ ai: { transcribeAudio: async () => ({ ok: true, text: "Quiero servicio médico, ¿cuánto cuesta?", seconds: 12 }) } });
  await h.run();
  assert.match(h.notes[0], /🎤 Transcripción de la nota de voz del cliente:\n«Quiero servicio médico, ¿cuánto cuesta\?»/);
  assert.match(h.sent[0], /\$1,100 MXN/);
  assert.doesNotMatch(h.sent[0], /no puedo escuchar/i);
  assert.ok(h.events.some(e => e.type === "audio_transcribed" && e.data.seconds === 12));
});

test("nota de voz de más de 10 min: pide lo principal por escrito o en un audio más corto", async () => {
  const h = harness({ ai: { transcribeAudio: async () => ({ ok: false, reason: "too_long", seconds: 700 }) } });
  await h.run();
  assert.match(h.sent[0], /más de 10 minutos/);
  assert.equal(h.notes.length, 0);
});
