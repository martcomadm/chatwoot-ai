// Mia libre (17-nov): 20% de los chats nuevos; sus expedientes, chats y avisos solo para quien tiene el permiso.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { canSeeSale, canRequestCall, isMiaLibreUser } from "../src/operations/access/areas.js";
import { OpsNotifier } from "../src/operations/notifications/ops-notifier.js";
import { saleInputFromMemory } from "../src/operations/sale-factory.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { lightShare } from "../src/core/mia-mode.js";
import { untakenAlerts } from "../src/operations/alert-escalation.js";

const libreSale = { sale_id: "S1", origin: "mia_libre", queue: "capture" };
const normalSale = { sale_id: "S2", queue: "capture" };
const users = [
  { username: "axel", active: true, areas: ["admin", "mia_libre"] },
  { username: "otra", active: true, areas: ["mia_libre"] },
  { username: "carla", active: true, areas: ["captura"] },
  { username: "jefe", active: true, areas: ["admin"] },
];

test("permisos: solo 'Mia libre' ve y trabaja sus expedientes; ni Admin ni Captura por su rol", () => {
  assert.equal(lightShare({}), 20);
  assert.equal(canSeeSale(users[0], libreSale), true);
  assert.equal(canSeeSale(users[1], libreSale), true);
  assert.equal(canSeeSale(users[2], libreSale), false);
  assert.equal(canSeeSale(users[3], libreSale), false, "Admin sin el permiso no lo ve");
  assert.equal(canSeeSale(users[2], normalSale), true);
  assert.equal(canRequestCall(users[1], libreSale), true);
  assert.equal(canRequestCall(users[2], libreSale), false);
  assert.equal(isMiaLibreUser(users[3]), false);
});

test("el expediente de un chat de Mia libre se marca y los avisos van solo a quienes tienen el permiso", async () => {
  const input = saleInputFromMemory({ conversationId: 9, conversation: { messages: [] }, memory: { mia_mode: "light", nombre: "Ana", sales_cycle: { authorized: true, selected_plan: "plan_1" } } });
  assert.equal(input.origin, "mia_libre");
  assert.equal(saleInputFromMemory({ conversationId: 9, conversation: { messages: [] }, memory: { sales_cycle: { authorized: true } } }).origin, null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-libre-"));
  const store = new SaleStore(path.join(dir, "s.json"));
  assert.equal(store.create({ ...input, status: "waiting_capture", queue: "capture" }).origin, "mia_libre");

  const sent = [];
  const notifier = new OpsNotifier({ users: { list: () => users } });
  notifier.on("notify", n => sent.push(n));
  notifier.libre = { saleIsLibre: id => id === "S1", chatIsLibre: id => Number(id) === 9 };
  await notifier.notify({ kind: "new", sale_id: "S1", to: ["carla"], title: "Nueva venta para Captura", url: "/operations/sales/S1" });
  await notifier.notify({ kind: "hot_lead", conversation_id: 9, to: ["carla"], title: "Cliente listo", url: "/operations?area=chats&chat=9" });
  await notifier.notify({ kind: "new", sale_id: "S2", to: ["carla"], title: "Nueva venta para Captura" });
  assert.deepEqual(sent.map(n => n.to), [["axel", "otra"], ["axel", "otra"], ["carla"]]);
  assert.equal(sent[0].title, "Mia libre · Nueva venta para Captura");
  assert.equal(sent[1].url, "/operations?area=mia_libre&chat=9");
});

test("el resumen de avisos sin tomar de Captura no incluye chats de Mia libre", () => {
  const at = new Date(Date.now() - 30 * 60000).toISOString();
  const items = untakenAlerts([{ id: 1, nombre: "A", hot_lead_alert: { at, reason: "x" } }, { id: 2, nombre: "B", mia_mode: "light", hot_lead_alert: { at, reason: "x" } }], { afterMinutes: 15 });
  assert.deepEqual(items.map(i => i.id), [1]);
});

test("en Mia libre, un pase a una persona va al equipo de Mia libre (no a Atención ni a asesores)", async () => {
  const { ConversationProcessor } = await import("../src/core/conversation-processor.js");
  const sent = []; const routed = [];
  let mem = { presentacion_realizada: true, ultima_respuesta_agente: "Hola", mia_mode: "light" };
  const m = { id: 1, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Quiero hablar con un asesor humano por favor", attachments: [], created_at: 1 };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: { customerServiceTeamId: 4 } },
    chatwoot: { async getConversation() { return { id: 5, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m] }; }, async sendMessage(_i, t, priv) { if (!priv) sent.push(t); }, async getMessages() { return { payload: [] }; }, async assignTeam() { routed.push("team"); } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, v) { mem = v; }, async merge(_i, v) { mem = { ...mem, ...v }; }, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "x" }), repairDecision: async () => ({}), handoffSummary: async () => "resumen" },
    inspectorEvents: { async record() {} }, handoffRouter: { async route() { routed.push("asesores"); return {}; } },
  });
  p.libreHandoff = { async route(x) { routed.push(["libre", x.conversationId]); return { agent: { name: "Axel" }, assigned: true }; } };
  await p.process(5, { ids: ["1"], webhookMessages: new Map([["1", m]]) });
  assert.deepEqual(routed, [["libre", 5]]);
  assert.match(sent.at(-1), /persona de nuestro equipo|asesor/);
});

test("Mia libre no pasa a Atención a Clientes: ni al completar ni cuando el cliente vuelve a escribir", async () => {
  const { CustomerService } = await import("../src/operations/customer-service/customer-service.js");
  const handled = [];
  const cs = Object.create(CustomerService.prototype);
  cs.store = { openForConversation() { throw new Error("no debe abrir caso"); } };
  cs.libre = { isLibre: (id, sale) => sale?.origin === "mia_libre" || id === 9, handle: async x => handled.push(x.kind) };
  assert.equal(await cs.openCase({ conversation_id: 1, kind: "completed_sale", sale: { origin: "mia_libre", sale_id: "S1" } }), null);
  assert.equal(await cs.openCase({ conversation_id: 9, kind: "returning" }), null);
  assert.deepEqual(handled, ["completed_sale", "returning"]);
  const { ChatwootWorkflowBridge } = await import("../src/operations/chatwoot-workflow-bridge.js");
  const recorded = []; const teams = [];
  const bridge = Object.create(ChatwootWorkflowBridge.prototype);
  Object.assign(bridge, { customerServiceTeamId: 4, chatwoot: { async assignTeam(id, t) { teams.push([id, t]); } }, labels: { async finalizeForCustomerService() { teams.push("labels"); } }, record: async (id, type) => recorded.push(type) });
  await bridge.completeHumanHandoff(1, { sale_id: "S1", origin: "mia_libre" });
  assert.deepEqual(teams, []); assert.deepEqual(recorded, ["completed_mia_libre"]);
});

test("en Mia libre el aviso de Validación lleva solo el número de Calidad (554 883 3726)", async () => {
  const { renderCustomerMessage } = await import("../src/operations/customer-messages.js");
  const libre = renderCustomerMessage("capture.completed", { sale: { origin: "mia_libre" } });
  assert.match(libre, /desde el siguiente número:\n📞 554 883 3726\n/);
  assert.doesNotMatch(libre, /561 485 8202/);
  assert.match(renderCustomerMessage("capture.completed", { sale: {} }), /561 485 8202[\s\S]*554 883 3726/);
  const custom = renderCustomerMessage("capture.completed", { sale: { origin: "mia_libre" } }, { "capture.completed": "Le llamaremos desde:\n📞 111 222 3333\n📞 444 555 6666\nGracias." });
  assert.equal(custom, "Le llamaremos desde:\n📞 554 883 3726\nGracias.");
});
