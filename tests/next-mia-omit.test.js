// Pedido 11-nov: botón "Omitir chat" en Chats de Mia. Mia ya no le escribe ni lo mueve.
import test from "node:test";
import assert from "node:assert/strict";
import { omitConversation, unomitConversation, chatOmitted } from "../src/operations/mia-intervention.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { skipReason } from "../src/sales/reactivation.js";
import { coldLeadSkipReason } from "../src/operations/cold-lead-alerts.js";
import { hotLeadReason } from "../src/operations/hot-lead-alerts.js";

function memStore(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [Number(k), v]));
  return { get: id => data.get(Number(id)) ? structuredClone(data.get(Number(id))) : undefined, async merge(id, patch) { data.set(Number(id), { ...(data.get(Number(id)) || {}), ...patch }); }, async set(id, v) { data.set(Number(id), v); }, hasProcessed: () => false, async markProcessedMany() {}, all: () => [...data.values()] };
}
const USER = { username: "carlos", name: "Carlos Ruiz" };

test("omitir y dejar de omitir", async () => {
  const memories = memStore({ 11344: { nombre: "Lizeth", sales_cycle: { recommended_plan: "plan_1" } } });
  const events = []; const auditLog = [];
  await omitConversation({ memories, conversationId: 11344, user: USER, note: "Lo atiende Carlos", audit: { record: (...a) => auditLog.push(a) }, inspectorEvents: { record: async (_i, t) => events.push(t) } });
  const m = memories.get(11344);
  assert.equal(chatOmitted(m), true);
  assert.equal(m.mia_omitted.by, "Carlos Ruiz");
  assert.equal(m.mia_omitted.note, "Lo atiende Carlos");
  assert.deepEqual(events, ["mia_omitted"]);
  assert.equal(auditLog[0][0], "mia.omit");
  await assert.rejects(omitConversation({ memories, conversationId: 11344, user: USER }), /ya lo omitió Carlos Ruiz/);
  // Nada se le manda: ni reactivación, ni avisos a Captura.
  assert.equal(skipReason(m), "omitted");
  assert.equal(coldLeadSkipReason({ ...m, sales_cycle: { pitched_plans: ["plan_1"] } }, { mia_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }), "omitted");
  assert.equal(hotLeadReason({ memory: m, text: "me urge, cómo pago" }), null);
  await unomitConversation({ memories, conversationId: 11344, user: USER });
  assert.equal(chatOmitted(memories.get(11344)), false);
  await assert.rejects(unomitConversation({ memories, conversationId: 11344, user: USER }), /no está omitido/);
});

test("Mia no contesta un chat omitido, aunque el cliente escriba", async () => {
  const memories = memStore({ 54: { presentacion_realizada: true, mia_omitted: { active: true, by: "Carlos" } } });
  const message = { id: 904, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Entonces quién es la señorita que me llama", attachments: [] };
  const sent = []; const events = [];
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 54, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } }, memories, agentRotation: {},
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "LLM", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, t, d) { events.push([t, d]); } }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
  });
  await p.process(54, { ids: ["904"], webhookMessages: new Map([["904", message]]) });
  assert.deepEqual(sent, []);
  assert.ok(events.some(([t, d]) => t === "mia_paused_skip" && d.reason === "omitted"));
});

test("Chats de Mia: los omitidos salen de las listas y quedan en 'Omitidos' (también al buscarlos)", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { MemoryStore } = await import("../src/memory/memory-store.js");
  const { InspectorEventStore } = await import("../src/inspector/event-store.js");
  const { MiaConsole } = await import("../src/inspector/mia-console.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-omit-"));
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const events = new InspectorEventStore(path.join(dir, "e.json"));
  for (const id of [1, 2, 3]) {
    await memories.merge(id, { nombre: `Cliente ${id}`, sales_cycle: { stage: "exploring" } });
    await events.record(id, "ai_reply_sent", { customer_text: "Hola", reply: "¡Hola!", decision_source: "progressive_opening" });
  }
  await omitConversation({ memories, conversationId: 2, user: USER, note: "ya lo atiende Carlos" });
  const mia = new MiaConsole({ config: { ai: {} }, memories, inspectorEvents: events });
  const all = mia.rescueList({ filter: "all" });
  assert.deepEqual(all.items.map(i => i.id).sort(), [1, 3]);
  assert.equal(all.counts.omitted, 1);
  assert.equal(all.counts.all, 2);
  const omitted = mia.rescueList({ filter: "omitted" });
  assert.deepEqual(omitted.items.map(i => [i.id, i.omitted.by, i.omitted.note]), [[2, "Carlos Ruiz", "ya lo atiende Carlos"]]);
  assert.equal(mia.rescueList({ filter: "all", search: "Cliente 2" }).items[0].id, 2);
});
