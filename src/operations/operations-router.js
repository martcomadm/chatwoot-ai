import express from "express";
import { operationsPage } from "./operations-page-fixed.js";
import { saleDetailPage } from "./sale-detail-page.js";

export function createOperationsRouter({config,saleStore,workflow,memories,inspectorEvents}){
  const router=express.Router();
  function authorized(req){const expected=config.operations?.token;if(!expected)return false;return req.get("x-operations-token")===expected||req.query.token===expected}
  function guard(req,res,next){if(!authorized(req))return res.status(401).json({error:"Token de Operations inválido"});next()}
  function action(handler){return async(req,res)=>{try{return res.json({ok:true,sale:await handler(req)})}catch(error){return res.status(400).json({error:error.message})}}}
  function chatwootConversationUrl(sale){if(!sale?.conversation_id)return null;const base=String(config.chatwoot?.baseUrl||"").replace(/\/+$/,"");return `${base}/app/accounts/${config.chatwoot.accountId}/conversations/${sale.conversation_id}`}
  router.get("/operations",(_req,res)=>res.type("html").send(operationsPage()));
  router.get("/operations/sales/:id",(req,res)=>res.type("html").send(saleDetailPage(req.params.id)));
  router.get("/operations/api/sales",guard,(req,res)=>{let items=saleStore.list({queue:req.query.queue||undefined,status:req.query.status||undefined});const documents=String(req.query.documents||"").toLowerCase();if(documents==="complete")items=items.filter(s=>s.documents?.complete===true);if(documents==="incomplete")items=items.filter(s=>s.documents?.complete!==true);const search=String(req.query.search||"").trim().toLowerCase();if(search)items=items.filter(s=>[s.sale_id,s.customer?.nombre,s.customer?.telefono,s.customer?.curp,s.customer?.nss,s.conversation_id,s.payment?.reference].some(v=>String(v||"").toLowerCase().includes(search)));res.json({items})});
  router.get("/operations/api/sales/:id",guard,(req,res)=>{const sale=saleStore.get(req.params.id);if(!sale)return res.status(404).json({error:"Expediente no encontrado"});res.json({sale,links:{chatwoot:chatwootConversationUrl(sale)}})});
  router.post("/operations/api/lab/reset-conversation",guard,async(req,res)=>{
    try{
      if(String(config.appEnv||"").toLowerCase()!=="next")return res.status(403).json({error:"Reset LAB solo está disponible en APP_ENV=next"});
      const conversationId=Number(req.body?.conversation_id);
      if(!Number.isInteger(conversationId)||conversationId<=0)return res.status(400).json({error:"conversation_id inválido"});
      if(req.body?.confirm!==`RESET ${conversationId}`)return res.status(400).json({error:`Confirmación requerida: RESET ${conversationId}`});
      const previousMemory=memories?.get(conversationId);
      const removedSales=saleStore.deleteByConversationId(conversationId);
      await memories?.clear(conversationId);
      await inspectorEvents?.record(conversationId,"lab.conversation_reset",{conversation_id:conversationId,removed_sale_ids:removedSales.map(s=>s.sale_id),had_memory:Boolean(previousMemory?.actualizado_en),requested_by:"operations_lab"});
      console.warn(`NEXT LAB reset conversación ${conversationId}; expedientes eliminados: ${removedSales.map(s=>s.sale_id).join(",")||"ninguno"}`);
      return res.json({ok:true,conversation_id:conversationId,memory_cleared:true,removed_sale_ids:removedSales.map(s=>s.sale_id)});
    }catch(error){return res.status(400).json({error:error.message})}
  });
  router.post("/operations/api/sales",guard,action(req=>workflow.openAuthorizedSale(req.body||{})));
  router.post("/operations/api/sales/:id/documents/sync",guard,action(req=>workflow.syncDocuments(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/capture/start",guard,action(req=>workflow.startCapture(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/capture/complete",guard,action(req=>workflow.completeCapture(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validation/check",guard,action(req=>workflow.setValidationCheck(req.params.id,req.body?.key,req.body?.checked,req.body||{})));
  router.post("/operations/api/sales/:id/validation/correction",guard,action(req=>workflow.requestCorrection(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validation/reject",guard,action(req=>workflow.rejectValidation(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validation/reopen",guard,action(req=>workflow.reopenRejected(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validity/confirm",guard,action(req=>workflow.confirmValidity(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validity/issue",guard,action(req=>workflow.reportValidityIssue(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/validity/reopen",guard,action(req=>workflow.reopenValidity(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/payment/request",guard,action(req=>workflow.requestPayment(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/payment/receive",guard,action(req=>workflow.receivePayment(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/payment/issue",guard,action(req=>workflow.reportPaymentIssue(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/payment/reopen",guard,action(req=>workflow.reopenPayment(req.params.id,req.body||{})));
  router.post("/operations/api/sales/:id/payment/validate",guard,action(req=>workflow.validatePayment(req.params.id,req.body||{})));
  router.get("/operations/api/events",guard,(req,res)=>{res.setHeader("Content-Type","text/event-stream");res.setHeader("Cache-Control","no-cache");res.setHeader("Connection","keep-alive");res.flushHeaders?.();res.write(`data: ${JSON.stringify({type:"connected"})}\n\n`);const listener=event=>res.write(`data: ${JSON.stringify(event)}\n\n`);saleStore.on("sale",listener);const keepAlive=setInterval(()=>res.write(": keepalive\n\n"),25000);req.on("close",()=>{clearInterval(keepAlive);saleStore.off("sale",listener)})});
  return router;
}
