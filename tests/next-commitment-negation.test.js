import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNextSale, detectAuthorization, detectAltaInterest, detectExplicitPlanSelection } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { negatesCommitment } from "../src/sales/commitment-negation.js";

const recommended = {
  sales_cycle: { stage: "plan_recommended", recommended_plan: "plan_1", selected_plan: null, interested: true, authorized: false },
};

for (const phrase of [
  "ya no quiero continuar",
  "No quiero iniciar el trámite",
  "no, mejor no procedamos",
  "Todavía no iniciemos, lo pienso",
  "no lo quiero contratar",
  "No me interesa continuar con el proceso",
  "mejor no, gracias",
  "no estoy seguro de iniciar el trámite",
  "no quiero darme de alta",
  "Cancela el trámite por favor",
]) {
  test(`frase negativa NO autoriza ni abre expediente: ${phrase}`, () => {
    assert.equal(negatesCommitment(phrase), true);
    assert.equal(detectAuthorization(phrase), false);
    const result = analyzeNextSale(phrase, recommended);
    assert.equal(result.authorized, false);
    assert.equal(result.patch.sales_cycle.authorized, false);
    assert.notEqual(result.patch.sales_cycle.stage, "authorized");
    assert.equal(result.interested, false);
    assert.equal(commitmentDecision(recommended, phrase), null);
  });
}

test("negación de alta y de plan no cuenta como interés ni selección", () => {
  assert.equal(detectAltaInterest("No quiero darme de alta todavía"), false);
  assert.equal(detectExplicitPlanSelection("no quiero el plan 2"), null);
});

test("verbo de inicio sin trámite no autoriza (quiero empezar a entender)", () => {
  assert.equal(detectAuthorization("quiero empezar a entender bien cómo funciona"), false);
  assert.equal(analyzeNextSale("quiero empezar a entender bien", recommended).authorized, false);
});

for (const phrase of [
  "Sí, quiero iniciar el trámite",
  "Procedamos con el trámite",
  "No hay problema, iniciemos el proceso",
  "Sí, ¿por qué no? empecemos el trámite",
  "quiero contratar el plan 1",
  "Quiero continuar.",
]) {
  test(`frase afirmativa sigue autorizando: ${phrase}`, () => {
    assert.equal(negatesCommitment(phrase), false);
    assert.equal(detectAuthorization(phrase), true);
    assert.equal(analyzeNextSale(phrase, recommended).patch.sales_cycle.authorized, true);
  });
}
