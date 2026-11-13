import test from "node:test";
import assert from "node:assert/strict";
import { genericInterest, shortAffirmative, confirmsStart } from "../src/sales/start-confirmation.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";

const explained = {
  presentacion_realizada: true,
  commercial_need: { service_medical: true },
  necesidad_principal: "servicio medico",
  sales_cycle: { stage: "explaining", recommended_plan: "plan_1", authorized: false },
  ultima_respuesta_agente: "Perfecto. Si lo que buscas principalmente es servicio médico, el Plan 1 puede ser una buena opción. Tiene un costo de $1,100 MXN e incluye servicio médico del IMSS y continuación de semanas cotizadas; también permite registrar beneficiarios conforme a las reglas del IMSS. ¿Quieres que te explique cómo funciona?",
};

test("interés genérico se reconoce; necesidades y negaciones no", () => {
  for (const t of ["si me interesa", "Sí, me interesa mucho", "me interesa", "suena bien", "ok me convence", "sí me gusta ese plan"]) assert.equal(genericInterest(t), true, t);
  for (const t of ["me interesa AFORE e Infonavit", "no me interesa", "me interesa saber el precio", "ya no me interesa"]) assert.equal(genericInterest(t), false, t);
});

test("'sí me interesa' con plan en conversación avanza al cierre, no repite la recomendación", () => {
  const decision = commitmentDecision(explained, "si me interesa");
  assert.equal(decision.commitment, "interested");
  assert.match(decision.reply, /Plan 1 de \$1,100 MXN/);
  assert.match(decision.reply, /¿Quieres que iniciemos tu trámite\?/);
  assert.doesNotMatch(decision.reply, /puede ser una buena opción/);
  const sale = analyzeNextSale("si me interesa", explained);
  assert.equal(sale.patch.sales_cycle.interested, true);
  assert.equal(sale.patch.sales_cycle.stage, "interested");
  assert.equal(sale.patch.sales_cycle.authorized, false, "el interés todavía no autoriza");
});

test("'sí' después de '¿Quieres que iniciemos tu trámite?' autoriza", () => {
  const asked = { ...explained, sales_cycle: { ...explained.sales_cycle, stage: "interested", interested: true }, ultima_respuesta_agente: "¡Qué bien! Entonces seguimos con Plan 1 de $1,100 MXN. ¿Quieres que iniciemos tu trámite? Si antes tienes alguna duda, con gusto te la resuelvo." };
  for (const t of ["sí", "Si, por favor", "claro", "va", "ok sí, iniciemos"]) {
    assert.equal(confirmsStart(t, asked), true, t);
    assert.equal(analyzeNextSale(t, asked).patch.sales_cycle.authorized, true, t);
    assert.equal(commitmentDecision(asked, t)?.commitment, "authorized", t);
  }
  for (const t of ["no", "todavía no", "sí, pero antes una duda: ¿cuánto tarda?"]) {
    assert.equal(analyzeNextSale(t, asked).patch.sales_cycle.authorized, false, t);
  }
});

test("'sí' después de ofrecer una explicación NO autoriza", () => {
  assert.equal(shortAffirmative("sí"), true);
  assert.equal(confirmsStart("sí", explained), false);
  assert.equal(analyzeNextSale("sí", explained).patch.sales_cycle.authorized, false);
});

function processorFor(memoryRef, sent, workflow) {
  return new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion" }, operations: {} },
    chatwoot: {
      async getConversation() { return structuredClone(memoryRef.conversation); },
      async sendMessage(_id, text) { sent.push(text); },
      async getMessages() { return { payload: [] }; },
    },
    labels: { async mergeSafe() {} },
    memories: { get: () => structuredClone(memoryRef.memory), async set(_id, next) { memoryRef.memory = structuredClone(next); }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: new Proxy({}, { get: () => async () => ({}) }),
    inspectorEvents: { async record() {} },
    handoffRouter: {},
    workflow,
  });
}

async function runConversation(texts) {
  const sent = [];
  const ref = { memory: structuredClone(explained), conversation: null };
  const store = new SaleStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "martcom-interest-")), "sales.json"));
  const workflow = new SaleWorkflowEngine(store);
  let id = 1000;
  for (const content of texts) {
    id += 1;
    const message = { id, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content, attachments: [] };
    ref.conversation = { id: 900, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
    await processorFor(ref, sent, workflow).process(900, { ids: [String(id)], webhookMessages: new Map([[String(id), message]]) });
  }
  return { sent, memory: ref.memory, sale: store.findByConversationId(900) };
}

test("conversación completa: 'si me interesa' → pregunta de inicio → 'sí' → expediente abierto", async () => {
  const flow = await runConversation(["si me interesa", "sí"]);
  assert.match(flow.sent[0], /¿Quieres que iniciemos tu trámite\?/);
  assert.doesNotMatch(flow.sent[0], /puede ser una buena opción/);
  assert.equal(flow.memory.sales_cycle.authorized, true);
  assert.equal(flow.memory.sales_cycle.selected_plan, "plan_1");
  assert.ok(flow.sale, "se abre el expediente");
  // El "sí" contextual se comporta igual que una autorización explícita.
  const explicit = await runConversation(["si me interesa", "Procedamos con el trámite"]);
  assert.equal(flow.sent[1], explicit.sent[1]);
});
