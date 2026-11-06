import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { HandoffRotationStore, HandoffRouter } from "../src/handoff/index.js";
import { DEFAULT_HUMAN_HANDOFF_AGENTS } from "../src/config.js";

// 23-oct: atención humana → Jaqueline (62), Erika (58), Ricardo (60), Brenda (59).
// Las solicitudes de llamada siguen con la rotación de asesores.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-human-"));
  const assigned = [];
  const chatwoot = { async assignConversation(id, agent) { assigned.push([id, agent]); return { id: agent }; } };
  const human = [{ id: 62, name: "Jaqueline Juárez" }, { id: 58, name: "Erika Balanzario" }, { id: 60, name: "Ricardo Guzman" }, { id: 59, name: "Brenda Torres" }];
  const advisors = [{ id: 26, name: "Pamela Montiel" }, { id: 31, name: "Tonatiuh Ramirez" }];
  const cfg = agents => ({ ai: { timezone: "America/Mexico_City" }, handoff: { enabled: true, weekdayAgents: agents, saturdayAgents: agents, sundayAgents: agents } });
  const handoffRouter = new HandoffRouter({ config: cfg(advisors), store: new HandoffRotationStore(path.join(dir, "a.json")), chatwoot });
  const humanHandoffRouter = new HandoffRouter({ config: cfg(human), store: new HandoffRotationStore(path.join(dir, "h.json")), chatwoot });
  return { assigned, handoffRouter, humanHandoffRouter };
}

function processorFor(env, text, id) {
  const msgs = [{ id: 500 + id, message_type: 0, content: text, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 }];
  return new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage() {}, async getMessages() { return { payload: msgs }; }, ...{ assignConversation: env.handoffRouter.chatwoot.assignConversation } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => ({ presentacion_realizada: true, ultima_respuesta_agente: "x" }), async set() {}, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "resumen" },
    inspectorEvents: { async record() {} }, handoffRouter: env.handoffRouter, humanHandoffRouter: env.humanHandoffRouter, workflow: null,
  }).process(id, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) });
}

test("pide hablar con una persona → rotación de atención humana; pide llamada → asesores", async () => {
  const env = setup();
  await processorFor(env, "Quiero hablar con un asesor humano", 1);
  await processorFor(env, "No quiero hablar con un robot", 2);
  await processorFor(env, "Quiero una llamada con mi asesor", 3);
  await processorFor(env, "Le puedo marcar xfa", 4);
  const byConv = Object.fromEntries(env.assigned.map(([c, a]) => [c, a]));
  assert.ok([62, 58, 60, 59].includes(byConv[1]) && [62, 58, 60, 59].includes(byConv[2]));
  assert.notEqual(byConv[1], byConv[2], "rota entre las 4 personas");
  assert.ok([26, 31].includes(byConv[3]) && [26, 31].includes(byConv[4]), "las llamadas siguen con los asesores");
});

test("la rotación de atención humana por defecto son las 4 personas", () => {
  assert.equal(DEFAULT_HUMAN_HANDOFF_AGENTS, "62:Jaqueline Juárez,58:Erika Balanzario,59:Brenda Torres");
});
