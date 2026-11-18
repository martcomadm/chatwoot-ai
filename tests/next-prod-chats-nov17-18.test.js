// Export del 17 al 18-nov (175 conversaciones).
import test from "node:test";
import assert from "node:assert/strict";
import { agentAskedToStart } from "../src/sales/start-confirmation.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { asksNoContact } from "../src/sales/reactivation.js";
import { menuChoiceText, NEED_MENU_TEXT } from "../src/sales/need-menu.js";
import { buildOnboardingDecision, onboardingPrompt } from "../src/operations/onboarding-service.js";

test("'¿Quieren que iniciemos su trámite…?' (usted o plural) es pregunta de cierre: el 'Sí' abre la venta (#11902)", () => {
  for (const q of ["¿Quieren que iniciemos su trámite con este plan?", "¿Quieren iniciar el trámite con este plan?", "¿Le gustaría que iniciemos su trámite?", "¿Desea que iniciemos?"]) {
    assert.equal(agentAskedToStart({ ultima_respuesta_agente: `El Plan 1 cuesta $1,100. ${q}` }), true, q);
  }
});

test("pagos al IMSS, 'los tengo que bloquear' y respuestas al menú", () => {
  for (const t of ["Me refiero al pago q se tiene q hacer al IMSS mensual cuanto seria?", "quiero saber las cuotas que se pagan al IMSS de cuanto Serian?"]) assert.equal(detectDirectRequest(t)?.answerKey, "pay_to_imss", t);
  assert.equal(detectDirectRequest("cuanto cuesta")?.answerKey, "price");
  assert.equal(asksNoContact("🎤 (nota de voz) yo creo que los tengo que bloquear porque ya hasta se me habló un asesor"), true);
  assert.equal(asksNoContact("no los voy a bloquear"), false);
  assert.ok(menuChoiceText(NEED_MENU_TEXT, "Número 2\nGracias"));
  assert.ok(menuChoiceText(NEED_MENU_TEXT, "Si sigo aqui\n1,3"));
});

test("expediente: CURP con error en el último carácter; preguntas con expediente completo se contestan", () => {
  const curp = { sales_cycle: { authorized: true }, operations: { sale_id: "S", onboarding_next: "curp", documents_missing: ["curp"] }, ultima_respuesta_agente: onboardingPrompt("curp") };
  assert.match(buildOnboardingDecision(curp, "AOVA670417MMSLLNOP").reply, /último carácter debe ser un número/);
  const done = { sales_cycle: { authorized: true, selected_plan: "plan_1" }, operations: { sale_id: "S", documents_complete: true, status: "waiting_capture", queue: "capture", plan: "plan_1" }, onboarding_complete_notified: true, ultima_respuesta_agente: "Listo" };
  assert.match(buildOnboardingDecision(done, "Disculpa quedaría con un saldo mensual de cuánto ??").reply, /\$1,100 MXN al mes, del Plan 1/);
  assert.equal(buildOnboardingDecision(done, "Una pregunta se cotizaría hasta los 65 años pero si faltan semanas cotizadas tengo que seguir pagando después de los 65"), null);
  assert.match(buildOnboardingDecision(done, "Sería la de 1,100").reply, /va con el Plan 1/);
  assert.equal(buildOnboardingDecision(done, "Gracias").reply, "");
});
