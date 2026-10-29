import test from "node:test";
import assert from "node:assert/strict";
import { detectDeferral } from "../src/sales/customer-deferral.js";
import { orchestrateConversation, startedBefore1997 } from "../src/orchestrator/conversation-orchestrator.js";
import { contextualPlanExplanation } from "../src/sales/progressive-disclosure.js";
import { acceptsAdvisorOffer } from "../src/core/human-request.js";

// Caso real de Silvia (16-oct): estuvo a punto de cerrar y se perdió.
const silvia = { commercial_need: { retirement: true }, pension_data: { cotizo_antes_1997: true }, sales_cycle: { selected_plan: "plan_2", pitched_plans: ["plan_2"], explained_plans: ["plan_2"] } };

test("'Deja platico con mi esposo! Yo me vuelvo a comunicar!' pospone: sin seguimiento insistente", () => {
  assert.equal(detectDeferral("Deja platico con mi esposo ! Yo me buelvo a comunicar! Gracias"), "later");
  assert.equal(detectDeferral("Lo consulto con mi esposa"), "later");
  assert.equal(detectDeferral("Yo me vuelvo a comunicar"), "later");
});

test("pensión con Plan 2 elegido: habla del Plan 2, reconoce Ley 73 y ofrece asesor (no re-explica)", () => {
  const o = orchestrateConversation("Y de cuanto alcansaria mi pension ??", silvia);
  assert.match(o.directAnswer, /Plan 2, de \$1,500/);
  assert.match(o.directAnswer, /Ley 73/);
  assert.match(o.directAnswer, /comunique con un asesor/);
  assert.doesNotMatch(o.directAnswer, /Plan 1/);
  assert.equal(acceptsAdvisorOffer("Si", o.directAnswer), true);
});

test("'Oriéntame por favor' en contexto de pensión: orientación + asesor", () => {
  const o = orchestrateConversation("Orientame por favor !", silvia);
  assert.equal(o.directRequest?.type, "pension_orientation");
  assert.match(o.directAnswer, /un asesor puede decirte cuánto te falta/);
  assert.equal(orchestrateConversation("Orientame por favor", {}).directRequest?.type, undefined, "sin contexto de pensión lo resuelve la IA");
});

test("cotizó antes de 1997: 'del 86 al 90' sí, 'tengo 57 años' no", () => {
  assert.equal(startedBefore1997("Trabaje del 86 al 90"), true);
  assert.equal(startedBefore1997("Trabaje de febrero de 1986 al marzo de 1990"), true);
  assert.equal(startedBefore1997("Mi nombre es Silvia, y tengo 57 años, trabaje por 4 años"), false);
});

test("un 'Si' no vuelve a mandar la explicación completa de un plan ya explicado", () => {
  const memory = { ...silvia, ultima_respuesta_agente: "…¿Quieres que te explique cómo funciona?" };
  const d = contextualPlanExplanation(memory, "Si");
  assert.match(d.reply, /^Te resumo el Plan 2/);
  assert.match(d.reply, /iniciemos tu trámite o prefieres que un asesor/);
});

test("después de que Mia se despide, 'Ok', 'Gracias', '👍' o 'aún no hablo con mi esposo' no reciben respuesta", async () => {
  const { deferralDecision, isCourtesy } = await import("../src/sales/customer-deferral.js");
  const closed = { nombre: "Silvia Garcia", ultima_respuesta_agente: "Con gusto, Silvia. Quedo al pendiente; cuando quieras continuar, escríbeme por aquí." };
  for (const text of ["Ok", "Gracias", "👍", "No gracias aun no eh ablado con mi esposo , yo me comunicaria con ustedes", "Ok gracias Mia!"]) {
    assert.equal(deferralDecision(closed, text)?.reply, "", text);
  }
  assert.equal(isCourtesy("¿Y cuánto cuesta el Plan 1?"), false, "una pregunta sí se contesta");
  assert.equal(deferralDecision(closed, "¿Y cuánto cuesta el Plan 1?"), null);
});

test("'No gracias' al seguimiento: despedida corta una sola vez", async () => {
  const { deferralDecision } = await import("../src/sales/customer-deferral.js");
  const d = deferralDecision({ nombre: "Silvia Garcia", ultima_respuesta_agente: "Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el Plan 2?" }, "No gracias !");
  assert.equal(d.deferral, "declined");
  assert.match(d.reply, /^Entendido, Silvia, gracias por tu tiempo/);
});

test("Ley 73: 13 meses de afiliación antes de tramitar la pensión", () => {
  const o = orchestrateConversation("Por cuanto tiempo ?", silvia);
  assert.equal(o.directRequest.type, "pension_min_term");
  assert.match(o.directAnswer, /al menos 13 meses/);
  assert.match(orchestrateConversation("¿Por cuánto tiempo tengo que pagar para pensionarme?", {}).directAnswer, /Si empezaste a cotizar antes del 1 de julio de 1997 \(Ley 73\)/);
  assert.notEqual(orchestrateConversation("¿Cuánto tiempo tarda el trámite?", silvia).directRequest?.type, "pension_min_term");
});

test("seguimiento programado antes de que el cliente pospusiera: se cancela", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { FollowUpStore, FollowUpService } = await import("../src/core/follow-up.js");
  const sent = [];
  const t0 = new Date("2026-10-16T17:00:00Z");
  const svc = new FollowUpService({
    store: new FollowUpStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fu-def-")), "f.json")),
    chatwoot: { async getConversation() { return { inbox_id: 7, status: "open", labels: [], meta: { assignee: { id: 53 } }, messages: [{ message_type: 1, content: "x", created_at: t0 / 1000 }] }; }, async sendMessage(_i, t) { sent.push(t); } },
    labels: { async mergeSafe() {} },
    memories: { get: () => ({ sales_cycle: { deferral: "later", deferral_at: new Date(t0.getTime() + 60000).toISOString() } }), async set() {} },
    config: { chatwoot: { inboxId: 7, agentId: 53 } }, inspectorEvents: { async record() {} },
  });
  svc.afterReply(5, { customerAt: t0, now: t0, reply: "x" });
  await svc.tick(new Date(t0.getTime() + 25 * 60000));
  assert.deepEqual(sent, []);
});
