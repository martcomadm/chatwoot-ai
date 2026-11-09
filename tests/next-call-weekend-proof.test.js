import test from "node:test";
import assert from "node:assert/strict";
import { ConversationProcessor, withCallOffer } from "../src/core/conversation-processor.js";
import { isTeamOff, nextTeamDay, parseOffDays } from "../src/core/team-days.js";
import { deferralDecision } from "../src/sales/customer-deferral.js";
import { confirmsStart } from "../src/sales/start-confirmation.js";
import { HotLeadAlerts, weekendPending } from "../src/operations/hot-lead-alerts.js";
import { orchestrateConversation } from "../src/orchestrator/conversation-orchestrator.js";
import { priceObjectionDecision } from "../src/sales/progressive-disclosure.js";

// 9-nov, puntos 4 (llamada antes), 5 (fin de semana) y prueba social (5,000 clientes, 5 años, reseñas).
const PLAN = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] }, ultima_respuesta_agente: "¿Quieres que iniciemos tu trámite?" };
const SUNDAY = new Date("2026-11-08T18:00:00Z"); // domingo 12:00 en México
const MONDAY = new Date("2026-11-09T16:00:00Z"); // lunes 10:00

test("prueba social en dudas de confianza y precio", () => {
  for (const t of ["Me dicen que hay mucho fraude, que tenga cuidado", "Que seguridad tengo que no me dan de baja después de pagar?", "Buenos días disculpe, qué es martcom"]) {
    assert.match(orchestrateConversation(t, PLAN).directAnswer || "", /5 años en el mercado y más de 5,000 clientes afiliados/, t);
  }
  assert.match(priceObjectionDecision(PLAN, "Está muy caro").reply, /primero compruebas tu alta en el IMSS y después pagas, y llevamos 5 años/);
});

test("dos objeciones seguidas: se ofrece la llamada en ese momento, una vez", async () => {
  assert.equal(withCallOffer("El precio es fijo. ¿Quieres que te explique qué incluye?"), "El precio es fijo. Si te ayuda a decidir, ¿prefieres que un asesor te llame unos minutos y lo resuelva contigo? Dime sí y a qué hora te queda bien, y te marcamos a este número.");
  let memory = { presentacion_realizada: true, ...structuredClone(PLAN) };
  const sent = [];
  const processor = new ConversationProcessor({
    config: { chatwoot: { inboxId: 7, agentId: 53 }, ai: { validationLabel: "validacion", publicName: "Mia de MARTCOM", maxReplyChars: 850 }, operations: {} },
    chatwoot: { async getConversation() { return { id: 61, inbox_id: 7, meta: { assignee: { id: 53 } }, labels: [], messages: [] }; }, async sendMessage(_id, t) { sent.push(t); }, async getMessages() { return { payload: [] }; } },
    labels: { async mergeSafe() { return []; } },
    memories: { get: () => structuredClone(memory), async set(_id, n) { memory = n; }, async merge() {}, hasProcessed: () => false, async markProcessedMany() {} },
    agentRotation: {}, ai: { extractAmbiguous: async () => ({}), generateDecision: async () => ({ reply: "LLM", question_key: null }), repairDecision: async () => ({ reply: "" }), handoffSummary: async () => "" },
    inspectorEvents: { async record() {} }, handoffRouter: {}, workflow: null, followUps: { afterReply() {}, customerWrote() {} },
  });
  processor.teamOffDays = new Set();
  const say = async (id, text) => {
    const m = { id, message_type: 0, sender_type: "Contact", sender: { type: "contact" }, private: false, content: text, attachments: [] };
    await processor.process(61, { ids: [String(id)], webhookMessages: new Map([[String(id), m]]) });
    return sent.at(-1);
  };
  assert.doesNotMatch(await say(1, "Está muy caro"), /asesor te llame/);
  assert.match(await say(2, "Me dicen que hay mucho fraude, que tenga cuidado"), /5,000 clientes.*¿prefieres que un asesor te llame unos minutos/s);
  assert.equal(memory.objection_streak, 2);
  assert.ok(memory.early_call_offer_at);
  assert.doesNotMatch(await say(3, "Sigue estando caro"), /asesor te llame/, "una sola vez");
});

test("días sin equipo: domingo por defecto; se aparta el lugar y la CURP acepta", () => {
  const off = parseOffDays("0");
  assert.equal(isTeamOff(SUNDAY, off), true);
  assert.equal(isTeamOff(MONDAY, off), false);
  assert.equal(nextTeamDay(SUNDAY, off), "mañana lunes");
  assert.equal(nextTeamDay(new Date("2026-11-07T18:00:00Z"), parseOffDays("6,0")), "el lunes");
  const d = deferralDecision(PLAN, "Lo pienso y le aviso", { teamOff: { today: "domingo", next: "mañana lunes" } });
  assert.match(d.reply, /hoy es domingo y el equipo arranca mañana lunes a primera hora\. Si me mandas hoy tu CURP, te aparto un lugar/);
  assert.equal(d.weekend_offer, true);
  assert.equal(confirmsStart("GOMA800101HDFRRN09", { ...PLAN, ultima_respuesta_agente: d.reply }), true);
  assert.doesNotMatch(deferralDecision({ ...PLAN, sales_cycle: { ...PLAN.sales_cycle, weekend_offer: "x" } }, "Lo pienso y le aviso", { teamOff: { today: "domingo", next: "mañana lunes" } }).reply, /te aparto/, "una vez");
  assert.doesNotMatch(deferralDecision(PLAN, "Lo pienso y le aviso").reply, /te aparto/, "entre semana, igual que antes");
});

test("lunes 9:00: Captura recibe los pendientes del domingo, una vez", async () => {
  const sunday = "2026-11-08T19:00:00Z";
  const mem = {
    1: { id: 1, nombre: "Rosa", sales_cycle: { authorized: true, authorized_at: sunday } },
    2: { id: 2, nombre: "Luis", sales_cycle: {}, hot_lead_alert: { at: sunday, reason: "Pregunta cómo se paga" } },
    3: { id: 3, nombre: "Ana", sales_cycle: { authorized: true, authorized_at: sunday }, operations: { documents_complete: true } },
    4: { id: 4, nombre: "Memo", sales_cycle: { authorized: true, authorized_at: "2026-11-06T19:00:00Z" } },
  };
  assert.deepEqual(weekendPending(Object.values(mem), { since: Date.parse("2026-11-08T06:00:00Z"), until: Date.parse("2026-11-09T06:00:00Z") }).map(i => i.id), [1, 2]);
  const notes = [];
  const alerts = new HotLeadAlerts({ memories: { list: () => Object.values(mem), async merge(id, p) { mem[id] = { ...mem[id], ...p }; } }, notifier: { areaUsers: () => ["pamela"], async notify(n) { notes.push(n); } }, offDays: parseOffDays("0") });
  assert.deepEqual(await alerts.weekendDigest(new Date("2026-11-09T13:00:00Z")), { sent: 0 }, "antes de las 9");
  assert.deepEqual(await alerts.weekendDigest(SUNDAY), { sent: 0 }, "en domingo no");
  assert.deepEqual(await alerts.weekendDigest(MONDAY), { sent: 2 });
  assert.equal(notes[0].title, "Pendientes del fin de semana: 2 clientes");
  assert.match(notes[0].body, /Rosa \(#1\): aceptó iniciar; faltan documentos · Luis \(#2\): pregunta cómo se paga/);
  assert.deepEqual(await alerts.weekendDigest(new Date(MONDAY.getTime() + 3600e3)), { sent: 0 }, "una vez");
});
