import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { buildWeeklyReview, WeeklyReviewService } from "../src/knowledge/weekly-review.js";
import { LearningInbox } from "../src/knowledge/learning-inbox.js";

// 9-nov, punto 2: Mia revisa la semana sola y propone respuestas a Supervisión.
const since = Date.parse("2026-11-02T06:00:00Z"), until = Date.parse("2026-11-09T06:00:00Z");
const t = (d, h = 12) => new Date(Date.parse(`2026-11-0${d}T${String(h).padStart(2, "0")}:00:00Z`)).toISOString();
const reply = (id, at, decision_source, reply, customer_text) => ({ conversationId: id, type: "ai_reply_sent", timestamp: at, details: { decision_source, reply, customer_text } });

function data() {
  const memories = [
    { id: 1, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], authorized: true, authorized_at: t(3, 13), authorization_text: "Sí, iniciemos" } },
    { id: 2, sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"], deferral: "no_money" }, profile: { objection: "precio" } },
    { id: 3, sales_cycle: {} },
    { id: 4, sales_cycle: { recommended_plan: "plan_1" } },
    { id: 5, sales_cycle: {} }, // chat viejo
  ];
  const events = [
    reply(1, t(3, 12), "contextual_plan_explanation", "Claro. El Plan 1 incluye… ¿Quieres que iniciemos tu trámite?", "Sí explíqueme"),
    reply(1, t(3, 14), "onboarding", "Para continuar compárteme tu CURP", "Sí, iniciemos"),
    reply(2, t(4), "contextual_plan_explanation", "Claro. El Plan 1 incluye… ¿Quieres que iniciemos tu trámite?", "Si"),
    reply(2, t(4, 13), "customer_deferral", "Entiendo… ¿Para qué fecha te acomoda?", "No tengo dinero"),
    reply(3, t(5), "fallback", "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?", "Debo actualizar mis datos primero en el IMSS"),
    reply(3, t(5, 13), "unknown", "Si te parece bien, ¿iniciamos tu trámite con el Plan 1?", "Necesito actualizar datos en el IMSS, mi nombre esta mal"),
    reply(4, t(6), "llm", "El Plan 1 cuesta $1,100 MXN mensuales…", "Cuanto cuesta"),
    reply(4, t(6, 13), "fallback", "¿Tienes alguna duda sobre el Plan 1 o quieres que iniciemos tu trámite?", "Hay que actualizar los datos del IMSS antes?"),
    reply(5, "2026-10-20T12:00:00Z", "llm", "x", "hola"),
  ];
  return { memories, events };
}

test("reporte: embudo, hasta dónde llegaron, dónde se van, motivos, preguntas sin respuesta y qué funcionó", () => {
  const { memories, events } = data();
  const r = buildWeeklyReview({ memories, events, since, until });
  assert.deepEqual({ chats: r.funnel.chats, saw: r.funnel.saw_plan, close: r.funnel.close, acc: r.funnel.accepted }, { chats: 4, saw: 3, close: 4, acc: 1 }, "la respuesta genérica también pregunta si iniciamos");
  assert.equal(r.funnel.accepted_of_close_pct, 25);
  assert.equal(r.stages.find(s => s.key === "accepted").count, 1);
  assert.equal(r.stages.find(s => s.key === "close").count, 3);
  assert.ok(r.drop_after.some(d => d.key === "Despedida por 'lo pospone'"));
  assert.deepEqual(r.reasons.map(x => x.key).sort(), ["Objeción: precio", "Sin dinero por ahora"]);
  assert.equal(r.unanswered[0].count, 3, "las tres formas de 'actualizar datos' se agrupan");
  assert.deepEqual(r.unanswered[0].conversations.sort(), [3, 4]);
  assert.equal(r.winners[0].key, "Explicación del plan");
  assert.equal(r.winners[0].examples[0].customer, "Sí, iniciemos");
});

test("servicio: propone respuestas a 'Preguntas que Mia no supo', avisa a Supervisión y corre solo los lunes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-weekly-"));
  const { memories, events } = data();
  const inbox = new LearningInbox({ file: path.join(dir, "l.json"), memories: { list: () => memories }, chatwoot: null });
  const notes = [];
  const svc = new WeeklyReviewService({
    file: path.join(dir, "w.json"), memories: { list: () => memories }, inspectorEvents: { listAll: () => events }, learningInbox: inbox,
    ai: { async draftTeamAnswer({ question }) { return `Propuesta para: ${question}`; } },
    notifier: { areaUsers: a => (a === "supervision" ? ["sofi"] : []), async notify(n) { notes.push(n); } },
  });
  const monday = new Date("2026-11-09T15:00:00Z"); // lunes 9:00 en México
  const r = await svc.tick(monday);
  assert.equal(r.funnel.chats, 4);
  assert.equal(r.proposals, 1);
  const open = inbox.list();
  assert.equal(open[0].source, "weekly");
  assert.match(open[0].answer, /^Propuesta para: Debo actualizar/);
  assert.match(notes[0].body, /4 chats nuevos · 1 aceptaron \(25%\)/);
  assert.equal(await svc.tick(new Date("2026-11-09T17:00:00Z")), null, "una vez por lunes");
  assert.equal(await svc.tick(new Date("2026-11-10T15:00:00Z")), null, "martes no");
  // Al volver a generar no se duplica la propuesta abierta.
  await svc.run({ now: monday, by: { username: "sofi" } });
  assert.equal(inbox.list().filter(i => i.source === "weekly").length, 1);
  assert.equal(svc.list().length, 2);
  const reread = new WeeklyReviewService({ file: path.join(dir, "w.json"), memories: { list: () => [] } });
  assert.equal(reread.latest().funnel.chats, 4, "se guarda en disco");
});
