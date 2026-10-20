import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor, scrubOpeners, undotted } from "../src/core/conversation-processor.js";
import { analyzeNextSale } from "../src/sales/next-sales-engine.js";
import { commitmentDecision } from "../src/sales/commitment-flow.js";
import { detectDeferral } from "../src/sales/customer-deferral.js";
import { rejectsFeature } from "../src/sales/feature-rejection.js";
import { deriveCommercialNeed } from "../src/sales/need-before-recommendation.js";
import { detectPlanPreference } from "../src/sales/next-sales-engine.js";
import { validateNameCandidate } from "../src/semantic/name-validator.js";
import { explicitHumanRequest } from "../src/core/human-request.js";
import { detectDirectRequest } from "../src/orchestrator/conversation-orchestrator.js";
import { adOpeningDecision } from "../src/sales/ad-openings.js";
import { buildOnboardingDecision } from "../src/operations/onboarding-service.js";
import { checkReply } from "../src/ai/quality-checker.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

// Chats reales del 19 y 20 de octubre (export del Inspector).

function harness({ memory = {}, text, llm = "«LLM»", recent = null }) {
  const sent = []; const events = []; let mem = structuredClone(memory);
  const msgs = text.split("\n").map((t, i) => ({ id: 990 + i, message_type: 0, content: t, private: false, attachments: [], sender: { type: "contact" }, sender_type: "Contact", created_at: 1000 + i }));
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: msgs }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: recent || msgs }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(mem), async set(_i, next) { mem = next; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: llm, question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } }, handoffRouter: {}, workflow: null,
  });
  return { run: () => p.process(80, { ids: msgs.map(m => String(m.id)), webhookMessages: new Map(msgs.map(m => [String(m.id), m])) }), sent, events, memory: () => mem };
}
const intro = { presentacion_realizada: true };

test("venta: 'Si por favor' a '¿Deseas que inicie tu trámite con el Plan 1?' autoriza con el Plan 1", () => {
  const memory = { sales_cycle: { recommended_plan: "plan_2", pitched_plans: ["plan_2"], explained_plans: ["plan_2"] }, ultima_respuesta_agente: "El Plan 1 es $1,100 MXN mensuales. ¿Deseas que inicie tu trámite con el Plan 1?" };
  const cycle = analyzeNextSale("Si por favor", memory).patch.sales_cycle;
  assert.equal(cycle.authorized, true);
  assert.equal(cycle.selected_plan, "plan_1");
  assert.equal(analyzeNextSale("Confirmo", { sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Confirmas que deseas iniciar el trámite con Plan 1?" }).patch.sales_cycle.authorized, true);
  assert.equal(analyzeNextSale("Ok", { sales_cycle: { recommended_plan: "plan_1" }, ultima_respuesta_agente: "¿Quieres que proceda con Plan 1?" }).patch.sales_cycle.authorized, true);
});

test("venta: 'Para el plan 1' cambia de plan y pregunta si iniciamos", () => {
  const memory = { sales_cycle: { recommended_plan: "plan_2", explained_plans: ["plan_2"] }, ultima_respuesta_agente: "…retomamos tu trámite con el Plan 2." };
  const cycle = analyzeNextSale("Para el plan 1", memory).patch.sales_cycle;
  assert.equal(cycle.selected_plan, "plan_1");
  const d = commitmentDecision({ ...memory, sales_cycle: cycle }, "Para el plan 1");
  assert.match(d.reply, /seleccionado el Plan 1 de \$1,100 MXN mensuales\. ¿Quieres que iniciemos tu trámite con el Plan 1\?/);
});

test("venta: la IA no pide 'He leído y acepto…' ni ofrece datos de pago antes del alta", () => {
  assert.ok(checkReply("Por favor responde exactamente: \"He leído y acepto los términos y condiciones\".", { memory: {} }).reasons.includes("pide_frase_terminos"));
  assert.ok(checkReply("¿Quieres que te comparta los datos para el pago?", { memory: {} }).reasons.includes("pago_antes_de_vigencia"));
  assert.doesNotMatch(MARTCOM_KNOWLEDGE, /Frase de referencia/);
  assert.match(MARTCOM_KNOWLEDGE, /NUNCA le pidas que escriba una frase exacta/);
});

test("'No me interesa Infonavit' no despide: ofrece el Plan 1", async () => {
  assert.equal(rejectsFeature("No me interesa Infonavit"), "infonavit");
  assert.equal(rejectsFeature("No me interesa"), null);
  const h = harness({ memory: { ...intro, sales_cycle: { recommended_plan: "plan_2", pitched_plans: ["plan_2"], explained_plans: ["plan_2"] }, ultima_respuesta_agente: "¿Te quedó alguna duda sobre el Plan 2?" }, text: "No me interesa Infonavit" });
  await h.run();
  assert.match(h.sent[0], /Plan 1 de \$1,100 MXN mensuales es suficiente/);
  assert.doesNotMatch(h.sent[0], /gracias por tu tiempo/);
  assert.equal(h.memory().sales_cycle.recommended_plan, "plan_1");
  assert.equal(h.memory().sales_cycle.deferral, undefined);
});

test("'Todo menos Infonavit' y 'Ya tengo mi afore' no llevan al Plan 2", () => {
  assert.equal(deriveCommercialNeed("Todo menos Infonavit").afore_infonavit, false);
  assert.equal(detectPlanPreference("Todo menos Infonavit"), "plan_1");
  assert.equal(deriveCommercialNeed("Ya tengo mi afore y mi seguro").afore_infonavit, false);
  assert.equal(detectPlanPreference("Ya tengo mi afore y mi seguro"), null);
  assert.equal(deriveCommercialNeed("quiero aportar a mi afore").afore_infonavit, true);
});

test("posponer: frases reales del 19 y 20-oct", () => {
  for (const t of ["Si gracias,boy a comentar y me comunico nuevamente si me interesa", "Primero platico coni familia y me comunico nuevamente\nGracias 🙏🏻", "Más delante gracias", "Por el momento no  gracias", "de momento no gracias", "Deja juntar y te vuelvo a mandar mensaje", undotted("Aurita.salgo.aber.donde.lo.consigo")]) {
    assert.equal(detectDeferral(t), "later", t);
  }
  assert.equal(detectDeferral(undotted("La verdad.noconsigi.el.dinero.para.depositarlo.i.aurita.notengo.ni.travajo.grasias")), "no_money");
});

test("después de una despedida no se agrega '¿Tienes alguna duda…?'", async () => {
  const memory = { ...intro, sales_cycle: { recommended_plan: "plan_1", pitched_plans: ["plan_1"], explained_plans: ["plan_1"] }, ultima_respuesta_agente: "Claro. El Plan 1 incluye…" };
  const h = harness({ memory, text: "No, es muy larga la explicación gracias", llm: "No hay problema. Si más adelante quieres un resumen breve, escríbeme. Que tengas buen día." });
  await h.run();
  assert.equal(h.sent[0], "No hay problema. Si más adelante quieres un resumen breve, escríbeme. Que tengas buen día.");
});

test("si una persona del equipo contestó después del cliente, Mia no se mete", async () => {
  const recent = [
    { id: 990, message_type: 0, content: "Comenzar con mi afiliación al IMSS", created_at: 1000, sender_type: "Contact" },
    { id: 991, message_type: 1, content: "Buen día. Te escribo para saber si aún te interesa…", created_at: 1005, sender_type: "User", sender: { id: 77, type: "user", name: "Jose Lara" } },
  ];
  const h = harness({ memory: {}, text: "Comenzar con mi afiliación al IMSS", recent });
  await h.run();
  assert.deepEqual(h.sent, []);
  assert.ok(h.events.some(e => e.type === "human_replied_skip"));
});

test("'Veo que…' se quita en vez de tirar toda la respuesta", () => {
  assert.equal(scrubOpeners("Veo que dejaste de cotizar en 2020. El Plan 1 te ayuda."), "Dejaste de cotizar en 2020. El Plan 1 te ayuda.");
  assert.equal(scrubOpeners("Gracias, veo que tienes 60 años."), "Gracias, tienes 60 años.");
});

test("Cobranza: '¿cuánto tengo que pagar?' da su monto; 'lo hago en un ratito' sin presión", () => {
  const memory = { sales_cycle: { authorized: true, selected_plan: "plan_1" }, onboarding_complete_notified: true, operations: { sale_id: "S", status: "payment_requested", queue: "payment", documents_complete: true, payment_requested: true } };
  assert.equal(buildOnboardingDecision(memory, "Cuánto es lo q tengo q pagar?").reply, "Tu pago es de $1,100 MXN, del Plan 1. Cuando lo realices, envíame por aquí tu comprobante, por favor.");
  assert.equal(buildOnboardingDecision(memory, "Uns. Disculpa ayer no pude hacer el depósito\nLo hago en un ratito por favor").reply, "Claro, sin problema. Cuando lo realices, envíame por aquí tu comprobante, por favor.");
});

test("frases: honorarios, agente que no sea IA, 'Aver expliqueme', anuncio + precio", () => {
  assert.equal(detectDirectRequest("me puede decir de sus honorarios ?")?.answerKey, "price");
  assert.equal(explicitHumanRequest("Tiene servicio per llamada con un agente sue no sea . IA"), true);
  assert.equal(explicitHumanRequest("No, quiero habla3 con alguien que no sea AI"), true);
  const d = adOpeningDecision({}, "Información y revisar mi caso con mi NSS\nmedaria informes cuanto cuesta");
  assert.match(d.reply, /Plan 1 de \$1,100 MXN mensuales/);
  assert.match(d.reply, /¿hace cuánto dejaste de cotizar/);
});

test("nombres falsos: 'Porfa Expliqueme', 'Nesecito Afiliarme'", () => {
  assert.equal(validateNameCandidate("Porfa Expliqueme").ok, false);
  assert.equal(validateNameCandidate("Nesecito Afiliarme").ok, false);
  assert.equal(validateNameCandidate("Maria Guadalupe Oviedo Uribe").ok, true);
});

test("respuestas confirmadas: ya cotiza con su trabajo, guardería con carta patronal, semanas que no aparecen", () => {
  assert.equal(detectDirectRequest("Actualmente estoy laborando y cuento con seguro")?.answerKey, "employed");
  assert.equal(detectDirectRequest("Si actualmente cotizo en el imss")?.answerKey, "employed");
  assert.notEqual(detectDirectRequest("ya renuncie, estaba cotizando en el imss")?.answerKey, "employed");
  assert.equal(detectDirectRequest("Y me piden la carta del patrón")?.answerKey, "daycare");
  assert.equal(detectDirectRequest("porque no me aparecen unas semanas de los 80s")?.answerKey, "missing_weeks");
  assert.match(MARTCOM_KNOWLEDGE, /proporciona el servicio de guardería del IMSS/);
  assert.match(MARTCOM_KNOWLEDGE, /directamente en su clínica del IMSS estando ya activo con nosotros/);
});

// Caso real 20-oct (Enedino): mandó fotos de sus documentos antes de aceptar; una persona del equipo
// preguntó "¿Te gustaría comenzar con tu trámite?"; dijo "Si por favor" y luego le pidieron la CURP.
test("documentos enviados antes de aceptar se revisan al autorizar; el 'sí' a la pregunta de una persona cuenta", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const { MemoryStore } = await import("../src/memory/memory-store.js");
  const { SaleStore } = await import("../src/operations/sale-store.js");
  const { SaleWorkflowEngine } = await import("../src/operations/workflow-engine.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-enedino-"));
  const memories = new MemoryStore(path.join(dir, "m.json"));
  const workflow = new SaleWorkflowEngine(new SaleStore(path.join(dir, "s.json")));
  await memories.set(80, { presentacion_realizada: true, nombre: "Enedino Calderón De Los Ríos", sales_cycle: { recommended_plan: "plan_2", selected_plan: "plan_1", pitched_plans: ["plan_1"], explained_plans: ["plan_1"] }, ultima_respuesta_agente: "Gracias, recibí tus documentos. Los usaremos para tu expediente en cuanto iniciemos tu trámite. ¿Quieres que iniciemos tu trámite con el Plan 1?" });
  const messages = [
    { id: 1, message_type: 0, content: "", attachments: [{ id: 501, file_type: "image", data_url: "https://chat/x/501.jpg" }], created_at: 100, sender_type: "Contact" },
    { id: 2, message_type: 1, content: "¿Te gustaría comenzar con tu trámite?", created_at: 200, sender_type: "User", sender: { id: 77, type: "user" } },
    { id: 3, message_type: 0, content: "Si por favor", created_at: 300, sender_type: "Contact", sender: { type: "contact" } },
  ];
  const sent = []; const events = []; let analyzed = null;
  const p = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 80, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: structuredClone(messages) }; }, async sendMessage(_i, t) { sent.push(t); }, async getMessages() { return { payload: messages.slice(-1) }; } },
    labels: { async mergeSafe() { return []; } }, memories, agentRotation: {}, handoffRouter: {}, workflow,
    ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "«LLM»" }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "", extractDocumentData: async atts => { analyzed = atts.map(a => a.id); return { curp_valor: "CADE650101HDFLLN09", nss_valor: "12345678901", ine_recibida: true }; } },
    inspectorEvents: { async record(_i, type, data) { events.push({ type, data }); } },
  });
  await p.process(80, { ids: ["3"], webhookMessages: new Map([["3", messages[2]]]) });
  assert.deepEqual(analyzed, [501]);
  const sale = workflow.store.findByConversationId(80);
  assert.equal(sale.sale.plan, "plan_1");
  assert.equal(sale.documents.complete, true);
  assert.match(sent.join(" "), /Listo, ya tengo los datos y documentos requeridos/);
  assert.ok(events.some(e => e.type === "earlier_documents_analyzed"));
});
