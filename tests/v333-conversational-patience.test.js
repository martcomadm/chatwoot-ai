import test from "node:test";
import assert from "node:assert/strict";
import { analyzePatience, sensitiveSlotSuppressed } from "../src/semantic/conversational-patience.js";
import { planNext } from "../src/sales/sales-engine.js";
import { validateNameCandidate } from "../src/semantic/name-validator.js";

const base={ultima_pregunta:"curp",flujo:{siguiente_paso:"curp"},slots:{},blocked_questions:[],resolved_questions:[],intereses:{imss:true},necesidad_principal:"afiliacion_imss",tiene_imss:false,nombre:"Rosalba Flores Campos",edad:61,actividad:"hogar"};

test("mañana te la mando pausa CURP",()=>{
 const r=analyzePatience("Mañana te lo puedo mandar porque estoy en un mandado",base);
 assert.equal(r.state,"promised_later");assert.equal(r.shouldPause,true);assert.equal(r.patch.data_collection.sensitive_requests_suppressed,true);
});
test("estoy buscando pausa CURP",()=>{
 const r=analyzePatience("Me permites, la estoy buscando",base);assert.equal(r.state,"searching");assert.equal(r.shouldPause,true);
});
test("no me sé su CURP queda unavailable",()=>{
 const r=analyzePatience("No me se su curp",base);assert.equal(r.state,"unavailable");assert.equal(r.patch.slots.curp_disponible,false);
});
test("presión detectada",()=>{
 const r=analyzePatience("Ya te dije que permitas lo estoy buscando",base);assert.equal(r.pressure,true);assert.equal(r.shouldPause,true);
});
test("slot sensible suprimido no vuelve al planner",()=>{
 const m={...base,ultima_pregunta:null,slots:{curp_estado:"promised_later"},data_collection:{sensitive_requests_suppressed:true}};
 const p=planNext(m);assert.notEqual(p.question_key,"curp");assert.notEqual(p.question_key,"nss");
});
test("Sería con salario mínimo no es nombre",()=>{assert.equal(validateNameCandidate("Sería con el salario mínimo").ok,false)});
