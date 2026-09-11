import test from "node:test";
import assert from "node:assert/strict";
import { contextualActivityPatch, enforcePreAuthorizationDecision, requestsSensitiveData } from "../src/core/next-commercial-guard.js";
import { fallbackDecision } from "../src/core/fallback.js";

test("respuesta a pregunta actividad conserva ocupación concreta", () => {
  const patch=contextualActivityPatch("Trabajo en oficina",{ultima_pregunta:"actividad"});
  assert.equal(patch.actividad,"oficina");
  assert.equal(patch.tipo_trabajo,"oficina");
  assert.deepEqual(patch.resolved_questions,["actividad"]);
});

test("otras ocupaciones naturales se vinculan a actividad por contexto", () => {
  assert.equal(contextualActivityPatch("Soy contador",{ultima_pregunta:"actividad"}).actividad,"contador");
  assert.equal(contextualActivityPatch("Laboro como albañil",{ultima_pregunta:"actividad"}).actividad,"albañil");
  assert.equal(contextualActivityPatch("Vendo ropa",{ultima_pregunta:"actividad"}).actividad,"Vendo ropa");
});

test("no convierte una pregunta comercial en actividad", () => {
  assert.equal(contextualActivityPatch("¿Cuánto cuesta el Plan 2?",{ultima_pregunta:"actividad"}),null);
});

test("detecta CURP/NSS aunque question_key venga null", () => {
  assert.equal(requestsSensitiveData({reply:"¿Me compartes tu CURP para preparar tu caso?",question_key:null}),true);
  assert.equal(requestsSensitiveData({reply:"¿Me compartes tu Número de Seguridad Social?",question_key:null}),true);
});

test("antes de autorización bloquea una solicitud de CURP generada por LLM", () => {
  const memory={sales_cycle:{authorized:false},orchestration:{},intereses:{},contexto_laboral:{}};
  const decision={reply:"Atendemos clientes de todo México. ¿Me compartes tu CURP para preparar tu caso?",question_key:null,add_labels:[],remove_labels:[],handoff:false};
  const guarded=enforcePreAuthorizationDecision(decision,{memory,planner:{action:"continuar_venta",question_key:null},combinedText:"Trabajo en oficina",fallbackDecision});
  assert.equal(requestsSensitiveData(guarded),false);
  assert.doesNotMatch(guarded.reply,/curp|nss|número de seguridad social/i);
});

test("después de autorización sí permite onboarding sensible", () => {
  const memory={sales_cycle:{authorized:true}};
  const decision={reply:"Para continuar con tu expediente, compárteme por favor la CURP del titular.",question_key:"curp"};
  const guarded=enforcePreAuthorizationDecision(decision,{memory,planner:{question_key:"curp"},combinedText:"",fallbackDecision});
  assert.equal(guarded,decision);
});
