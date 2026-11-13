import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ReactivationService } from "../src/operations/reactivation-service.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";
import { nextReactivation, reactivationReplyDecision } from "../src/sales/reactivation.js";
import { templateByName } from "../src/chatwoot/template-catalog.js";
import { detectDeferral, deferralDecision, detectClosing } from "../src/sales/customer-deferral.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { contextualNextStep } from "../src/core/fallback.js";
import { orchestrateConversation, detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { FACT_LOCKED_TYPES } from "../src/core/deterministic-decision-policy.js";

// Export del 5 al 9-nov (primer fin de semana con reactivación encendida).
const now = new Date("2026-11-20T18:00:00Z");
const ago = days => new Date(now.getTime() - days * 86400e3).toISOString();
const PLAN = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] } };

test("reactivación: no le escribe a chats con etiqueta de cierre o en pausa (convs 10367 y 10653)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-react9-"));
  const settings = new OpsSettingsStore(path.join(dir, "s.json"), path.join(dir, "i.bin"));
  settings.setReactivation({ enabled: true, daily_cap: 10 }, { username: "sofi" });
  const mem = { 1: { id: 1, ...PLAN }, 2: { id: 2, ...PLAN }, 3: { id: 3, ...PLAN } };
  const labels = { 1: ["validacion", "no_contesta"], 2: ["pausar_mia"], 3: ["no_contesta"] };
  const sent = [];
  const service = new ReactivationService({
    memories: { list: () => Object.values(mem), get: id => mem[id], async merge(id, patch) { mem[id] = { ...mem[id], ...patch }; } },
    inspectorEvents: { get: () => [{ timestamp: ago(3), details: { customer_text: "hola" } }], async record() {} },
    templates: { async sendNamed(id, name) { sent.push([id, name]); return { sent: true }; } },
    chatwoot: { async getConversation(id) { return { meta: { assignee: { id: 53 } }, labels: labels[id] }; } },
    settings, miaAgentId: 53,
  });
  assert.deepEqual(await service.tick(now), { sent: 1 });
  assert.deepEqual(sent, [[3, "seguimiento4"]]);
  assert.equal(mem[1].reactivation.blocked_label, "validacion");
  assert.equal(mem[2].reactivation.blocked_label, "pausar_mia");
  // Ya no se vuelve a intentar hasta que el cliente escriba de nuevo.
  assert.equal(nextReactivation(mem[1], { lastCustomerAt: ago(3), now }), null);
  assert.equal(nextReactivation(mem[1], { lastCustomerAt: new Date(now.getTime() + 60e3).toISOString(), now: new Date(now.getTime() + 3 * 86400e3) })?.template, "seguimiento4");
});

test("contesta la plantilla sin recordar la plática: '❓❔', '¿de dónde o qué es martcom?' (convs 11142 y 11429)", () => {
  // También cuando la plantilla fue la de 24 h del seguimiento (no queda en memory.reactivation).
  const afterTemplate = { ...PLAN, ultima_respuesta_agente: templateByName("seguimiento4").text };
  const r = reactivationReplyDecision(afterTemplate, "❓❔");
  assert.match(r.reply, /^¡Hola! Soy Mia, la asistente virtual de MARTCOM\..*¿Quieres que te explique cómo funciona el Plan 1\?$/s);
  assert.match(orchestrateConversation("Buenos días disculpe \nDe dónde o que es martcom", PLAN).directAnswer, /^MARTCOM es una consultoría privada/);
  assert.match(reactivationReplyDecision(afterTemplate, "Sí").reply, /cuéntame cuál es tu duda/);
  assert.equal(reactivationReplyDecision({ ...PLAN, ultima_respuesta_agente: "otra cosa" }, "❓"), null);
});

test("respuestas que faltaban: enfermedad, enviar semanas, corregir datos", () => {
  assert.equal(detectDirectRequest("Tengo enfetmedad renal, me podriad ayidar?")?.answerKey, "preexisting");
  assert.match(orchestrateConversation("Si, pero necesito enviarle mis semanas", PLAN).directAnswer, /envíame por aquí tu reporte de semanas/);
  assert.equal(detectDirectRequest("Puedo pasar mis semanas del ISSSTE?")?.answerKey, "advisor_topic");
  assert.match(orchestrateConversation("Y. Debo..actualizar. datos primero..segun", PLAN).directAnswer, /prefieres que un asesor te llame/i);
  for (const k of ["what_is_martcom", "send_weeks", "data_correction"]) assert.ok(FACT_LOCKED_TYPES.has(k), k);
});

test("respuesta genérica: no se repite en círculo; al acabarse ofrece la llamada (conv 11045)", () => {
  const m = { ...PLAN };
  const first = contextualNextStep(m);
  const second = contextualNextStep({ ...m, ultima_respuesta_agente: first });
  const third = contextualNextStep({ ...m, ultima_respuesta_agente: second });
  assert.notEqual(first, second);
  assert.match(third, /prefieres que un asesor te llame/i);
});

test("viaje, 'es una pregunta', bendiciones, 'qué plan me conviene', 'me gusta la idea de afiliarme'", () => {
  assert.equal(detectDeferral("Buenos días estoy de viaje y no leí la información"), "later");
  assert.equal(detectDeferral("Cuando regrese por favor"), "later");
  assert.equal(detectDeferral("Ahorita no me puedo pensionar es una prejunta"), null);
  assert.equal(detectClosing("Muchas gracias por tu apoyo Jehova Dios Les Bendiga y Los Proteja En Todo Momento"), true);
  assert.equal(detectClosing("Lindo día para ti también ☺️"), true);
  assert.match(deferralDecision(PLAN, "No me quedaron dudas está claro solo déjeme pensar bien que plan me conviene y ya le aviso").reply, /Por si te ayuda a decidir/);
  assert.equal(analyzeNextSale("Si muchas gracias 🫂 si me gusta  la idea de afiliarme aunque fui al imms y me dijeron q son fraudes y no lo creo pero me arriesgo xrqe necesito", PLAN).authorized, true);
  assert.equal(analyzeNextSale("no lo quiero contratar", PLAN).authorized, false);
});
