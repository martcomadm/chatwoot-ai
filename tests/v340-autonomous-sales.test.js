import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAutonomousSale, recommendPlan, salesInstruction } from "../src/sales/autonomous-sales-engine.js";

const base={tiene_imss:false,edad:50,necesidad_principal:"afiliacion_imss",intereses:{imss:true,semanas_cotizadas:true},necesidades:["semanas_cotizadas"],sales_cycle:{stage:"qualified",authorized:false}};

test("recomienda plan base para IMSS y semanas",()=>assert.equal(recommendPlan(base).id,"plan_base"));
test("recomienda Plan 2 cuando busca AFORE",()=>assert.equal(recommendPlan({...base,intereses:{afore:true}}).id,"plan_2"));
test("autorización explícita activa handoff",()=>{const r=analyzeAutonomousSale("Sí, quiero iniciar el trámite",base);assert.equal(r.authorized,true);assert.equal(r.shouldHandoff,true);assert.equal(r.stage,"authorized")});
test("pensarlo no activa handoff",()=>{const r=analyzeAutonomousSale("Déjame pensarlo",base);assert.equal(r.shouldHandoff,false)});
test("objeción de precio entra a objection_handling",()=>{const r=analyzeAutonomousSale("¿Cuánto cuesta?",base);assert.equal(r.stage,"objection_handling");assert.equal(r.shouldHandoff,false)});
test("instrucción comercial prohíbe CURP como requisito",()=>{const s=salesInstruction({...base,sales_cycle:{stage:"plan_recommended",plan_name:"Plan base"}});assert.match(s,/No pidas CURP\/NSS/)});
