import test from "node:test";
import assert from "node:assert/strict";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { compactPlanRecommendation, contextualPlanExplanation } from "../src/sales/progressive-disclosure.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";

// Chat real del 9 de octubre: tras explicar el Plan 2 ("Si estás de acuerdo, podemos iniciar
// el trámite."), el cliente dijo "Muy bien" y Mia repitió la recomendación de dos turnos antes.
const memoryAfterExplanation = {
  tiene_imss: false,
  commercial_need: { afore_infonavit: true },
  sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_2", pitched_plans: ["plan_2"], explained_plans: ["plan_2"] },
  ultima_respuesta_agente: contextualPlanExplanation({ commercial_need: { afore_infonavit: true }, sales_cycle: { recommended_plan: "plan_2" } }, "explícame cómo funciona").reply,
};

test("'Muy bien' después de 'podemos iniciar el trámite' autoriza el trámite", () => {
  assert.equal(confirmsStart("Muy bien", memoryAfterExplanation), true);
  const sale = analyzeNextSale("Muy bien", memoryAfterExplanation);
  assert.equal(sale.authorized, true);
  const decision = commitmentDecision(memoryAfterExplanation, "Muy bien");
  assert.equal(decision?.commitment, "authorized");
  assert.match(decision.reply, /iniciar el trámite con Plan 2/);
});

test("otras respuestas cortas de aceptación también cuentan tras ofrecer iniciar", () => {
  for (const text of ["Bien", "Bueno", "Listo", "Excelente", "Me parece bien", "Estoy de acuerdo", "Muy bien, gracias", "ok muy bien"]) {
    assert.equal(confirmsStart(text, memoryAfterExplanation), true, text);
  }
});

test("'Muy bien' sin que Mia haya ofrecido iniciar no autoriza nada", () => {
  const memory = { ...memoryAfterExplanation, ultima_respuesta_agente: "¿Actualmente cuentas con IMSS?" };
  assert.equal(confirmsStart("Muy bien", memory), false);
  assert.equal(analyzeNextSale("Muy bien", memory).authorized, false);
});

test("la recomendación del Plan 2 no se repite si ya se dio o ya se explicó", () => {
  const fresh = { commercial_need: { afore_infonavit: true }, sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_2" } };
  assert.match(compactPlanRecommendation(fresh, "No se cuenta con imss")?.reply || "", /Plan 2 puede ajustarse/);
  assert.equal(compactPlanRecommendation({ ...fresh, sales_cycle: { ...fresh.sales_cycle, pitched_plans: ["plan_2"] } }, "ok"), null);
  assert.equal(compactPlanRecommendation({ ...fresh, sales_cycle: { ...fresh.sales_cycle, explained_plans: ["plan_2"] } }, "ok"), null);
});

test("si cambia el plan, sí se recomienda el nuevo", () => {
  const memory = { commercial_need: { service_medical: true }, sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", pitched_plans: ["plan_2"] } };
  assert.match(compactPlanRecommendation(memory, "solo quiero servicio médico")?.reply || "", /Plan 1/);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";

test("conversación completa: explicación del Plan 2 → 'Muy bien' → expediente abierto y pide documentos", async () => {
  const sent = [];
  const ref = { memory: structuredClone(memoryAfterExplanation) };
  const store = new SaleStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "martcom-oct9-")), "sales.json"));
  const workflow = new SaleWorkflowEngine(store);
  const message = { id: 77, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: "Muy bien", attachments: [] };
  const conversation = { id: 901, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [message] };
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion" }, operations: {} },
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() {} },
    memories: { get: () => structuredClone(ref.memory), async set(_id, next) { ref.memory = structuredClone(next); }, async merge(_id, patch) { ref.memory = { ...ref.memory, ...patch, operations: { ...(ref.memory.operations || {}), ...(patch.operations || {}) } }; }, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {},
    ai: new Proxy({}, { get: () => async () => ({}) }),
    inspectorEvents: { async record() {} },
    handoffRouter: {},
    workflow,
  });
  await processor.process(901, { ids: ["77"], webhookMessages: new Map([["77", message]]) });
  assert.equal(ref.memory.sales_cycle.authorized, true);
  assert.equal(ref.memory.sales_cycle.selected_plan, "plan_2");
  assert.ok(store.findByConversationId(901), "se abre el expediente");
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /puede ajustarse mejor/, "no repite la recomendación");
  assert.match(sent[0], /CURP|INE|NSS/);
});
