import test from "node:test";
import assert from "node:assert/strict";
import { buildOnboardingDecision, onboardingStateFromSale, nextOnboardingRequirement } from "../src/operations/onboarding-service.js";

test("onboarding follows expediente missing order", () => {
  const sale={documents:{complete:false,missing:["nss","ine","csf"],checklist:{received_count:1,required_count:4}}};
  const state=onboardingStateFromSale(sale);
  assert.equal(state.onboarding_next,"nss");
  assert.deepEqual(state.documents_missing,["nss","ine","csf"]);
  assert.equal(nextOnboardingRequirement(sale),"nss");
});

test("authorized customer is asked only for current missing requirement", () => {
  const memory={sales_cycle:{authorized:true},operations:{sale_id:"MART-1",documents_complete:false,documents_missing:["ine","csf"],onboarding_next:"ine"}};
  const decision=buildOnboardingDecision(memory,"listo");
  assert.match(decision.reply,/INE/i);
  assert.equal(decision.onboarding_requirement,"ine");
});

test("completed package produces capture-ready confirmation", () => {
  const memory={sales_cycle:{authorized:true},operations:{sale_id:"MART-1",documents_complete:true,documents_missing:[],onboarding_next:null}};
  const decision=buildOnboardingDecision(memory,"ya quedó");
  assert.match(decision.reply,/expediente está completo/i);
  assert.equal(decision.question_key,null);
});

test("customer question interrupts deterministic document request", () => {
  const memory={sales_cycle:{authorized:true},operations:{sale_id:"MART-1",documents_complete:false,documents_missing:["csf"],onboarding_next:"csf"}};
  assert.equal(buildOnboardingDecision(memory,"¿Cuánto tarda el proceso?"),null);
});

test("onboarding does not run before authorization", () => {
  const memory={sales_cycle:{authorized:false},operations:{documents_missing:["curp"],onboarding_next:"curp"}};
  assert.equal(buildOnboardingDecision(memory,"hola"),null);
});
