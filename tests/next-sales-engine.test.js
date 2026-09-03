import test from "node:test";
import assert from "node:assert/strict";
import { analyzeNextSale, detectAuthorization, detectExplicitPlanSelection, detectPlanPreference } from "../src/sales/next-sales-engine.js";
import { mergeMemory } from "../src/ai/services.js";

const apply = (memory, text) => mergeMemory(memory, analyzeNextSale(text, memory).patch);

test("recommends Plan 1 for medical service and weeks", () => assert.equal(detectPlanPreference("Quiero servicio médico y seguir cotizando semanas"), "plan_1"));
test("recommends Plan 2 when AFORE is needed", () => assert.equal(detectPlanPreference("También me interesa AFORE"), "plan_2"));
test("recommends Plan 2 when INFONAVIT is needed", () => assert.equal(detectPlanPreference("Quiero juntar puntos de Infonavit"), "plan_2"));
test("explicit process authorization is detected", () => { assert.equal(detectAuthorization("Sí, quiero iniciar el trámite"), true); assert.equal(detectAuthorization("Adelante con el proceso"), true); });
test("choosing a plan is selection, not authorization", () => { assert.equal(detectExplicitPlanSelection("Me quedo con el plan 2"), "plan_2"); assert.equal(detectAuthorization("Me quedo con el plan 2"), false); });
test("thinking about it is not authorization", () => { assert.equal(detectAuthorization("Déjame pensarlo y te aviso más tarde"), false); assert.equal(detectAuthorization("Solo estoy preguntando"), false); });
test("comparing both plans does not invent recommendation", () => assert.equal(detectPlanPreference("¿Qué diferencia hay entre plan 1 y plan 2?"), null));
test("rejecting AFORE does not recommend Plan 2", () => assert.equal(detectPlanPreference("No me interesa AFORE, solo servicio médico"), "plan_1"));
test("commercial state persists recommendation", () => { const m=apply({},"Quiero seguro médico y semanas cotizadas"); assert.equal(m.sales_cycle.recommended_plan,"plan_1"); });
test("commercial state can move to Plan 2", () => { let m=apply({},"Quiero servicio médico");m=apply(m,"También quiero Infonavit");assert.equal(m.sales_cycle.recommended_plan,"plan_2"); });
test("price objection does not authorize", () => { const r=analyzeNextSale("Se me hace muy caro",{sales_cycle:{stage:"plan_recommended",recommended_plan:"plan_1"}});assert.equal(r.patch.sales_cycle.stage,"objection_handling");assert.equal(r.patch.sales_cycle.authorized,false); });
test("interest is different from authorization", () => { const r=analyzeNextSale("Me interesa, quiero saber más",{});assert.equal(r.patch.sales_cycle.interested,true);assert.equal(r.patch.sales_cycle.authorized,false); });
test("plan selection persists while authorization remains false", () => { const m=apply({},"Me quedo con el Plan 2");assert.equal(m.sales_cycle.selected_plan,"plan_2");assert.equal(m.sales_cycle.authorized,false); });
test("authorization persists selected plan", () => { let m=apply({},"Me interesa AFORE e Infonavit");m=apply(m,"Sí, quiero iniciar el trámite");assert.equal(m.sales_cycle.authorized,true);assert.equal(m.sales_cycle.selected_plan,"plan_2"); });
test("authorization remains an operations signal, not a forced handoff", () => { const m=apply({},"Sí, quiero iniciar el trámite");assert.equal(m.sales_cycle.authorized,true);assert.equal(m.sales_cycle.stage,"authorized"); });
test("sales_cycle and operations survive generic memory merge", () => { const m=mergeMemory({nombre:"Ana",sales_cycle:{recommended_plan:"plan_1"}},{operations:{sale_id:"MART-1",status:"waiting_capture"}});assert.equal(m.nombre,"Ana");assert.equal(m.sales_cycle.recommended_plan,"plan_1");assert.equal(m.operations.status,"waiting_capture"); });
