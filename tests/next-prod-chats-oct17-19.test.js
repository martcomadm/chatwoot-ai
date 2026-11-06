import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ConversationProcessor, undotted } from "../src/core/conversation-processor.js";
import { buildOnboardingDecision, ONBOARDING_COMPLETE_TEXT, operationsStatusText } from "../src/operations/onboarding-service.js";
import { renderCustomerMessage } from "../src/operations/customer-messages.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { detectDeferral, deferralDecision } from "../src/sales/customer-deferral.js";
import { detectDirectRequest, orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { plausibleName } from "../src/semantic/name-validator.js";
import { deriveCommercialNeed, hasCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { contextualPlanExplanation } from "../src/sales/progressive-disclosure.js";
import { contextualNextStep } from "../src/core/fallback.js";
import { analyzePatience } from "../src/semantic/conversational-patience.js";

// Chats reales del 16 al 19 de octubre (incluye las dos primeras ventas cerradas por Mia).

function harness({ memory = {}, text, conversation = {}, generated = { reply: "", question_key: null }, templates = null }) {
  const sent = []; const events = []; let mem = structuredClone(memory);
  const m = { id: 990, message_type: 0, content: text, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact" };
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [m], ...conversation }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => generated, repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } }, handoffRouter: {}, workflow: null, templates,
  });
  return { run: () => p.process(80, { ids: ["990"], webhookMessages: new Map([["990", m]]) }), sent, events, memory: () => mem };
}

test("fuera de la ventana de 24 h no se manda texto libre ('Error al enviar'): se manda la plantilla una vez", async () => {
  const tpl = [];
  const templates = { enabled: () => true, send: async (id, key) => { tpl.push([id, key]); return { sent: true, name: "saludodia3" }; } };
  const h = harness({ memory: { presentacion_realizada: true, ultima_respuesta_agente: "x" }, text: "Hola quisiera información", conversation: { can_reply: false }, generated: { reply: "Con gusto te ayudo, ¿cuál es tu nombre?" }, templates });
  await h.run();
  assert.deepEqual(h.sent, []);
  assert.deepEqual(tpl, [[80, "followUp24h"]]);
  assert.ok(h.events.some(e => e.type === "reply_outside_window"));
});

test("ventas: el 'Listo, ya tengo los datos…' sale una vez; luego estado del trámite o nada", () => {
  const base = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", documents_complete: true } };
  assert.equal(buildOnboardingDecision({ ...base, ultima_respuesta_agente: "Gracias. Ahora compárteme por favor el NSS del titular." }, "11796275789").reply, ONBOARDING_COMPLETE_TEXT);
  const after = { ...base, onboarding_complete_notified: true, ultima_respuesta_agente: ONBOARDING_COMPLETE_TEXT };
  for (const t of ["Ok", "Muchas gracias", "Gracias quedó pendiente", "Oi\nOk"]) assert.equal(buildOnboardingDecision(after, t).reply, "", t);
  const paying = { ...after, operations: { ...base.operations, payment_requested: true } };
  assert.equal(buildOnboardingDecision(paying, "RECIBO77").reply, "");
  assert.match(buildOnboardingDecision(paying, "¿cómo va mi trámite?").reply, /solo falta tu pago/);
  assert.match(operationsStatusText({ validation_approved: true }), /validación ya fue aprobada/);
});

test("ventas: 'Muchas gracias' con trámite iniciado no recibe 'cuando quieras continuar…'", () => {
  assert.equal(deferralDecision({ sales_cycle: { authorized: true }, nombre: "Rivera Licea Jesús", ultima_respuesta_agente: ONBOARDING_COMPLETE_TEXT }, "Muchas gracias"), null);
});

test("ventas: el mensaje de pago lleva el monto aunque el expediente no lo tenga en payment", () => {
  assert.match(renderCustomerMessage("payment.requested", { sale: { sale: { plan: "plan_1" }, payment: {} } }), /\$1,100/);
  assert.match(renderCustomerMessage("payment.requested", { sale: { sale: { plan: "plan_2", precio: 1500 }, payment: {} } }), /\$1,500/);
});

test("ventas: 'Si' a '¿iniciemos tu trámite?' abre el expediente aunque el plan solo se haya recomendado", () => {
  const memory = { sales_cycle: { pitched_plans: ["plan_1"], explained_plans: ["plan_1"], stage: "exploring" }, ultima_respuesta_agente: "…Todo el trámite se hace por este medio. ¿Quieres que iniciemos tu trámite?" };
  const sale = analyzeNextSale("Si", memory).patch.sales_cycle;
  assert.equal(sale.authorized, true);
  assert.equal(sale.selected_plan, "plan_1");
});

test("ventas: una CURP con el trámite iniciado no es 'revisión de caso'", async () => {
  const h = harness({ memory: { presentacion_realizada: true, sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "S1", onboarding_next: "curp", documents_missing: ["curp", "nss"] }, ultima_respuesta_agente: "Para continuar con tu expediente, compárteme por favor la CURP del titular." }, text: "Sazg620625hdflnl04" });
  await h.run();
  assert.doesNotMatch(h.sent.join(" "), /revisión de tu caso/);
});

test("posponer: frases reales del 17-oct", () => {
  for (const t of ["Buenos días, lo estoy considerando gracias", "Te mando mañana es que voy en el camión", "Para el siguiente mes", "Le comparto los documentos el 1 de noviembre", "Estoy ocupada, disculpe. Si, lunes o martes, Gracias", "Ummm voy de salida si pues y gusta le mando mensaje la nomás que regrese", "Si me interesa sería ahora que renuncie", "No estoy platicando con mi familia para ver"]) {
    assert.equal(detectDeferral(t), "later", t);
  }
});

test("'Permítame un momento' / 'deme un momento' recibe 'Claro, aquí te espero.'", () => {
  const p = analyzePatience("Claro permitame por favor un momento", {});
  assert.equal(p.shouldPause, true);
  assert.equal(p.reply, "Claro, aquí te espero.");
});

test("preguntas que antes se ignoraban", () => {
  const cases = {
    "¡Hola! Quiero más información, en toda la república tienen el Servicio?": "location",
    "Hola cómo saber si estoy cotizando": "check_weeks",
    "Perfecto en tu experiencia que plan conviene más?": "which_plan",
    "Le comento estoy pensionado por invalidez por el imss": "already_pensioned",
    "Que salario promedio diario manejas en esta de 1100": "registered_salary",
    "Buenos días que salario pones para cotizar imms": "registered_salary",
    "En cualquier caso de enfermedad ,si hay hospitalización,si se cobran incapacidades": "disability",
    "Me das información si tienes el servicio completo": "medical_access_scope",
    "Necesito tener la certeza de la legalidad del trámite": "legitimacy",
  };
  for (const [t, type] of Object.entries(cases)) assert.equal(detectDirectRequest(t)?.type, type, t);
});

test("varias preguntas en un mensaje se contestan juntas", () => {
  const o = orchestrateConversation("Y el plan 2 que me incluye\nY cuánto tengo que aportar\nY que garantía tengo que es verdad lo que usted me dice", {});
  assert.equal(o.directRequest.type, "multi");
  assert.match(o.directAnswer, /Plan 2 tiene un costo de \$1,500/);
  assert.match(o.directAnswer, /Tu alta queda registrada ante el IMSS/);
  assert.match(o.directAnswer, /\?$/);
});

test("segunda duda de legitimidad: se ofrece un asesor", () => {
  const o = orchestrateConversation("Si tengo muchas dudas y no se que tan seguro sea hacerlo de esta manera", { sales_cycle: { trust_answered: true } });
  assert.match(o.directAnswer, /comunique con un asesor/);
});

test("nombres con abreviatura y mensajes con puntos en vez de espacios", () => {
  assert.equal(plausibleName("Ma.Magdalena Banda Mendoza"), true);
  assert.equal(plausibleName("Ma. Magdalena Banda Mendoza"), true);
  assert.equal(undotted("Si.pero.de.ayi.cuanto.tienpo.me.puedo.pensionar."), "Si pero de ayi cuanto tienpo me puedo pensionar.");
});

test("necesidad: 'aportaciones' = AFORE, 'en todo' tras la pregunta = Plan 2; plan elegido = necesidad conocida", () => {
  assert.equal(deriveCommercialNeed("Que me diga cómo puedo hacer esas aportaciones").afore_infonavit, true);
  assert.equal(deriveCommercialNeed("solo hay un número de alta sin aportaciones").afore_infonavit, false);
  assert.equal(hasCommercialNeed({ sales_cycle: { selected_plan: "plan_1" } }), true);
});

test("'¿Quieres que te explique cómo funciona el Plan 2?' + 'Si por favor' explica el Plan 2", () => {
  const d = contextualPlanExplanation({ sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "…No manejamos incapacidades permanentes ni por riesgo de trabajo. ¿Quieres que te explique cómo funciona el Plan 2?" }, "Si por favor");
  assert.match(d.reply, /Plan 2 cuesta \$1,500/);
});

test("respaldo sin plan identificado: nunca '¿Hay algo más en lo que te pueda ayudar?'", () => {
  assert.doesNotMatch(contextualNextStep({ necesidad_principal: "nunca tuve seguro propio" }), /Hay algo más/);
});

test("respuesta sin siguiente paso ('Anotado que eres transportista/chofer.'): se agrega", async () => {
  const h = harness({ memory: { presentacion_realizada: true, nombre: "José Guadalupe Muñoz", edad: 59, ultima_respuesta_agente: "¿A qué te dedicas actualmente?", commercial_need: { weeks: true }, sales_cycle: { pitched_plans: ["plan_1"] } }, text: "Tranpotista o chofer", generated: { reply: "Anotado que eres transportista/chofer.", question_key: null } });
  await h.run();
  assert.match(h.sent[0], /^Anotado que eres transportista\/chofer\. .+\?$/);
});

test("la misma respuesta de consulta no se manda dos veces seguidas (Modalidad 40 a Martín)", async () => {
  const m40 = orchestrateConversation("en mi situación no puedo acceder a modalidad 40", {}).directAnswer;
  const h = harness({ memory: { presentacion_realizada: true, ultima_respuesta_agente: m40 }, text: "Buen os días en ni situación no puedo acceder a modalidad 40" });
  await h.run();
  assert.notEqual(h.sent[0], m40);
  assert.match(h.sent[0], /comunique con uno/);
});

test("'¿Me podrías proporcionar una página?' recibe la página oficial", () => {
  for (const t of ["Me podrías proporcionar una página para conocer más de sus servicios", "¿Tienen página web?", "Me pasas su facebook"]) {
    const o = orchestrateConversation(t, {});
    assert.equal(o.directRequest?.type, "website", t);
    assert.match(o.directAnswer, /https:\/\/martcom-econtact\.mx\//);
  }
  assert.notEqual(detectDirectRequest("¿En qué página del contrato viene?")?.type, "website");
});

test("venta de Jesús Miguel completa: el aviso de expediente completo sale una sola vez", () => {
  let mem = { sales_cycle: { authorized: true }, operations: { sale_id: "S1", documents_complete: true }, ultima_respuesta_agente: "Gracias. Ahora compárteme por favor el NSS del titular." };
  const replies = [];
  for (const [text, ops] of [["11796275789", {}], ["Muchas gracias", {}], ["Gracias quedó pendiente", {}], ["RECIBO77", { validation_approved: true }], ["Oi\nOk", { validity_confirmed: true }], ["Ok", { payment_requested: true }], ["Gracias, quedo pendiente de su comprobante y tenga excelente día", {}]]) {
    mem.operations = { ...mem.operations, ...ops };
    const d = deferralDecision(mem, text) || buildOnboardingDecision(mem, text);
    if (d?.reply) { replies.push(d.reply); mem.ultima_respuesta_agente = d.reply; if (d.reply === ONBOARDING_COMPLETE_TEXT) mem.onboarding_complete_notified = true; }
  }
  assert.deepEqual(replies, [ONBOARDING_COMPLETE_TEXT]);
  assert.match(buildOnboardingDecision(mem, "¿Ya quedó mi alta?").reply, /solo falta tu pago/);
});
