// Prueba A/B "modo ligero" (17-nov).
import test from "node:test";
import assert from "node:assert/strict";
import { assignMiaMode, modeBucket, lightShare, isLightMode } from "../src/core/mia-mode.js";

test("solo conversaciones nuevas reciben modo; el reparto es estable y respeta el porcentaje", () => {
  const ids = Array.from({ length: 400 }, (_, i) => 1000 + i);
  const light = ids.filter(id => isLightMode(assignMiaMode({}, id, { share: 50 }))).length;
  assert.ok(light > 160 && light < 240, `reparto ${light}/400`);
  assert.equal(assignMiaMode({}, 7, { share: 50 }).mia_mode, assignMiaMode({}, 7, { share: 50 }).mia_mode);
  const m = assignMiaMode({}, ids.find(id => modeBucket(id) < 50), { share: 50 });
  assert.equal(m.mia_mode, "light");
  assert.deepEqual({ slot: m.experiments.mia_mode_v1.slot, variant: m.experiments.mia_mode_v1.variant }, { slot: "mia_mode", variant: "B" });
  assert.equal(assignMiaMode({ ultima_respuesta_agente: "Hola" }, 7, { share: 100 }).mia_mode, undefined, "chat que ya existía");
  assert.equal(assignMiaMode({}, 7, { share: 0 }).mia_mode, undefined, "0 apaga la prueba");
  assert.equal(assignMiaMode({ mia_mode: "full" }, 7, { share: 100 }).mia_mode, "full", "no cambia de modo");
  assert.equal(lightShare({ MIA_LIBRE_SHARE: "30" }), 30);
  assert.equal(lightShare({}), 20);
});

test("en modo ligero las reglas no contestan: responde la IA; 'no me escriban' sigue protegido", async () => {
  const { ConversationProcessor } = await import("../src/core/conversation-processor.js");
  const run = async (content, memory) => {
    const sent = []; let mem = structuredClone(memory);
    const m = { id: 1, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [], created_at: 1 };
    const p = new ConversationProcessor({
      config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
      chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) sent.push(t); }, async getMessages() { return { payload: [] }; } },
      labels: { async mergeSafe() { return []; } },
      memories: { get: () => structuredClone(mem), async set(_i, v) { mem = v; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
      agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "Con gusto te cuento: tenemos dos planes para que sigas cotizando y tengas servicio médico. ¿Qué te interesa más?", question_key: null }), repairDecision: async () => ({}), handoffSummary: async () => "" },
      inspectorEvents: { async record() {} }, handoffRouter: {},
    });
    await p.process(5, { ids: ["1"], webhookMessages: new Map([["1", m]]) });
    return { sent, mem };
  };
  const base = { presentacion_realizada: true, ultima_respuesta_agente: "Hola" };
  const full = await run("Cuanto cuesta", { ...base, mia_mode: "full" });
  assert.match(full.sent[0], /\$1,100/);
  const light = await run("Cuanto cuesta", { ...base, mia_mode: "light" });
  assert.match(light.sent[0], /dos planes para que sigas cotizando/);
  assert.match((await run("Ya no me escriban", { ...base, mia_mode: "light" })).sent[0], /ya no te enviaremos mensajes/);
});
