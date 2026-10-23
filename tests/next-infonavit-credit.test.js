import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor } from "../src/core/conversation-processor.js";
import { hasActiveInfonavitCredit, INFONAVIT_CREDIT_TEXT, INFONAVIT_CREDIT_PLAN2_TEXT, INFONAVIT_CREDIT_PRICE_TEXT } from "../src/sales/infonavit-credit.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { effectivePlan } from "../src/sales/progressive-disclosure.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";

// Indicación de MARTCOM (22-oct): a quien tiene crédito INFONAVIT activo no se le ofrece el Plan 2.

function harness({ memory = {}, text, llm = "«LLM»" }) {
  const sent = []; const events = []; let mem = structuredClone(memory);
  const msgs = text.split("\n").map((t, i) => ({ id: 990 + i, message_type: 0, content: t, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 + i }));
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: msgs }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: llm, question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } }, handoffRouter: {}, workflow: null,
  });
  return { run: () => p.process(80, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) }), sent, events, memory: () => mem };
}

test("detecta crédito INFONAVIT activo (y no confunde con querer uno o ya pagado)", () => {
  for (const t of ["Esq yo pago Infonavit", "tengo crédito infonavit", "estoy pagando mi casa de infonavit", "me descuentan infonavit", "tengo una casa del infonavit"]) assert.equal(hasActiveInfonavitCredit(t), true, t);
  for (const t of ["no tengo credito infonavit", "ya pagué mi crédito infonavit", "quiero sacar un credito infonavit", "me interesa infonavit", "servicio médico, semanas e infonavit"]) assert.equal(hasActiveInfonavitCredit(t), false, t);
});

test("con el crédito, el Plan 2 nunca se recomienda ni se elige", () => {
  const cycle = analyzeNextSale("Servicio médico, semanas e infonavit, pero tengo crédito infonavit", {}).patch.sales_cycle;
  assert.equal(cycle.infonavit_credit, true);
  assert.notEqual(cycle.recommended_plan, "plan_2");
  const memory = { sales_cycle: { infonavit_credit: true, recommended_plan: "plan_1" }, commercial_need: { afore_infonavit: true } };
  assert.equal(effectivePlan(memory), "plan_1");
  assert.equal(analyzeNextSale("quiero el plan 2", memory).patch.sales_cycle.recommended_plan, "plan_1");
  assert.equal(commitmentDecision(memory, "Mejor el plan 2").reply, INFONAVIT_CREDIT_PLAN2_TEXT);
});

test("conversación: al decirlo se le explica; precio y beneficios del Plan 2 ya no se ofrecen", async () => {
  const first = harness({ memory: { presentacion_realizada: true, sales_cycle: { recommended_plan: "plan_2", pitched_plans: ["plan_2"] }, commercial_need: { afore_infonavit: true }, ultima_respuesta_agente: "¿Confirmas que quieres iniciar con el Plan 2?" }, text: "Esq yo pago Infonavit" });
  await first.run();
  assert.equal(first.sent.at(-1), INFONAVIT_CREDIT_TEXT);
  assert.equal(first.memory().sales_cycle.infonavit_credit, true);
  const mem = first.memory();
  const price = harness({ memory: mem, text: "¿Cuánto cuesta?" });
  await price.run();
  assert.match(price.sent.at(-1), new RegExp(`^${INFONAVIT_CREDIT_PRICE_TEXT.slice(0, 40).replace(/[$().]/g, "\\$&")}`));
  assert.doesNotMatch(price.sent.at(-1), /\$1,500/);
  const benefits = harness({ memory: mem, text: "¿Cuáles son los beneficios del plan 2?" });
  await benefits.run();
  assert.equal(benefits.sent.at(-1), INFONAVIT_CREDIT_PLAN2_TEXT);
  const llm = harness({ memory: mem, text: "¿y qué me recomiendas para mi retiro?", llm: "Te recomiendo el Plan 2 por $1,500 MXN con AFORE." });
  await llm.run();
  assert.equal(llm.sent.at(-1), INFONAVIT_CREDIT_PLAN2_TEXT);
});
