import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SaleStore } from "../src/operations/sale-store.js";
import { SaleWorkflowEngine } from "../src/operations/workflow-engine.js";

function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"martcom-validation-"));const store=new SaleStore(path.join(dir,"sales.json"));const workflow=new SaleWorkflowEngine(store);const sale=workflow.openAuthorizedSale({conversation_id:991,customer:{nombre:"Cliente",curp:"ABCD001122HDFRRN09",nss:"12345678901"},sale:{plan:"plan_2",precio:1500,authorized:true},documents:{files:[{id:"ine",type:"ine",name:"INE.pdf"},{id:"csf",type:"csf",name:"CSF.pdf"}]}});workflow.startCapture(sale.sale_id,{name:"Captura"});workflow.completeCapture(sale.sale_id);return{workflow,store,id:sale.sale_id}}

test("validation needs all four checks before advancing",()=>{const {workflow,store,id}=setup();for(const key of ["datos","alta","documentos"])workflow.setValidationCheck(id,key,true,{by:"Validador"});assert.equal(store.get(id).queue,"validation");workflow.setValidationCheck(id,"revision_final",true,{by:"Validador"});assert.equal(store.get(id).queue,"validity");assert.equal(store.get(id).validation.approved,true)});

test("validation can return a case to capture with mandatory reason",()=>{const {workflow,store,id}=setup();assert.throws(()=>workflow.requestCorrection(id,{target:"capture"}),/motivo/i);workflow.requestCorrection(id,{target:"capture",reason:"Corregir dato del alta",by:"Validador"});const sale=store.get(id);assert.equal(sale.queue,"capture");assert.equal(sale.status,"capture_in_progress");assert.equal(sale.validation.correction.open,true)});

test("customer correction returns to capture and records reason",()=>{const {workflow,store,id}=setup();workflow.requestCorrection(id,{target:"customer",reason:"Enviar INE legible",by:"Validador"});const sale=store.get(id);assert.equal(sale.queue,"capture");assert.equal(sale.status,"waiting_capture");assert.equal(sale.validation.correction.target,"customer")});

test("rejection requires reason and can be reopened",()=>{const {workflow,store,id}=setup();assert.throws(()=>workflow.rejectValidation(id,{}),/motivo/i);workflow.rejectValidation(id,{reason:"Datos no corresponden",by:"Validador"});assert.equal(store.get(id).status,"validation_rejected");workflow.reopenRejected(id,{by:"Supervisor"});assert.equal(store.get(id).status,"validation_in_progress");assert.equal(store.get(id).validation.rejected,false)});
