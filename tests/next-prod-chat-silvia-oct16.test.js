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
  const o = orchestrateConversation("Por cuanto tiempo ? Y de cuanto alcansaria mi pension ??", silvia);
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
