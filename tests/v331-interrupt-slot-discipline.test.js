import test from "node:test";
import assert from "node:assert/strict";
import { validateNameCandidate, extractValidatedName } from "../src/semantic/name-validator.js";
import { resolveAnswer } from "../src/semantic/answer-resolver.js";
import { analyzeJudgment } from "../src/orchestrator/conversational-judgment.js";
import { classifyIntent } from "../src/intent/intent-engine.js";
import { INTENTS } from "../src/intent/catalog.js";
import { planNext } from "../src/sales/sales-engine.js";

test("REG-PRICE-NAME costo no se convierte en nombre",()=>{
  assert.equal(validateNameCandidate("Si Pero Que Costo Tendria").ok,false);
  assert.equal(extractValidatedName("Si pero que costo tendria",{ultima_pregunta:"nombre"}),null);
});
test("REG-IMSS natural tengo seguro resuelve pregunta IMSS",()=>{
  const r=resolveAnswer("Es que tengo seguro\nSi tengo el serv",{ultima_pregunta:"tiene_imss"});
  assert.equal(r.patch.tiene_imss,true);
  assert.ok(r.resolved.includes("tiene_imss"));
});
test("REG-PRICE segunda solicitud no hace handoff",()=>{
  const one=analyzeJudgment("Si pero que costo tendria",{intent:{id:"COTIZACION_SEMANAS"},judgment:{}});
  assert.equal(one.shouldHandoff,false);
  const two=analyzeJudgment("Necesito el costo",{intent:{id:"COTIZACION_SEMANAS"},judgment:one.patch.judgment});
  assert.equal(two.patch.judgment.price_requests,2);
  assert.equal(two.shouldHandoff,false);
  assert.equal(two.interrupt.resume_planner,true);
});
test("REG-PRICE tercera solicitud sí escala",()=>{
  const r=analyzeJudgment("Costo por favor",{intent:{id:"COTIZACION_SEMANAS"},judgment:{price_requests:2}});
  assert.equal(r.patch.judgment.price_requests,3);
  assert.equal(r.shouldHandoff,true);
});
test("REG-INTENT cotización para completar semanas",()=>{
  assert.equal(classifyIntent("Necesito cotizar para acompletar mis semanas").id,INTENTS.COTIZACION_SEMANAS);
});
test("REG-FLOW edad antes de nombre",()=>{
  const planner=planNext({intent:{id:INTENTS.COTIZACION_SEMANAS},tiene_imss:true,edad:null,nombre:null,actividad:"independiente",resolved_questions:["tiene_imss","actividad"],intereses:{semanas_cotizadas:true},contradicciones:[],slots:{}});
  assert.equal(planner.question_key,"edad");
});
test("REG-FLOW IMSS confirmado no se repite",()=>{
  const planner=planNext({intent:{id:INTENTS.COTIZACION_SEMANAS},tiene_imss:true,edad:52,nombre:null,actividad:"independiente",resolved_questions:["tiene_imss","edad","actividad"],intereses:{semanas_cotizadas:true},contradicciones:[],slots:{}});
  assert.notEqual(planner.question_key,"tiene_imss");
  assert.equal(planner.question_key,"nombre");
});
