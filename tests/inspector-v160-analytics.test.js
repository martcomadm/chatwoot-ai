import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics } from "../src/inspector/analytics-service.js";
const m=[
{id:1,actualizado_en:"2026-08-18T10:00:00-06:00",advisor_affinity:{agent_name:"Wendy",status:"assigned"},intent:{id:"COTIZACION_SEMANAS"},judgment:{price_requests:2},curp_recibida:true,flujo:{fase:"diagnostico"},nombre:"Ana",version:"3.3.2.1"},
{id:2,actualizado_en:"2026-08-18T11:00:00-06:00",advisor_affinity:{agent_name:"Wendy",status:"reserved"},intent:{id:"SERVICIO_MEDICO"},judgment:{human_preference:true},flujo:{fase:"diagnostico"},edad:30,version:"3.3.2.1"},
{id:3,actualizado_en:"2026-08-19T12:00:00-06:00",advisor_affinity:{agent_name:"Susana",status:"assigned"},intent:{id:"COTIZACION_SEMANAS"},contradicciones:["x"],nss_recibido:true,flujo:{fase:"diagnostico"},actividad:"independiente",version:"3.3.2.1"}
];
test("analytics KPIs",()=>{const d=buildAnalytics({memories:m,from:"2026-08-18",to:"2026-08-19",timezone:"America/Mexico_City",now:new Date("2026-08-20T10:00:00-06:00")});assert.equal(d.kpis.conversations,3);assert.equal(d.kpis.handoffs,2);assert.equal(d.kpis.price_objections,1);assert.equal(d.intents[0].count,2)});
test("analytics projection",()=>{const d=buildAnalytics({memories:m,timezone:"America/Mexico_City",now:new Date("2026-08-20T10:00:00-06:00")});assert.ok(d.projection.high>=d.projection.base);assert.ok(d.projection.conservative<=d.projection.base)});
