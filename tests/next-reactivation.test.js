import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { nextReactivation, resumeDate, asksNoContact, reactivationReplyDecision, skipReason } from "../src/sales/reactivation.js";
import { ReactivationService } from "../src/operations/reactivation-service.js";
import { OpsSettingsStore } from "../src/operations/access/settings-store.js";

// Reactivación de prospectos con plantillas aprobadas (5-nov).
const DAY = 24 * 3600 * 1000;
const now = new Date("2026-11-20T18:00:00Z"); // 12:00 en México
const ago = d => new Date(now.getTime() - d * DAY).toISOString();
const lead = (extra = {}) => ({ sales_cycle: { pitched_plans: ["plan_1"], recommended_plan: "plan_1", ...(extra.sales_cycle || {}) }, ...extra, ...(extra.sales_cycle ? { sales_cycle: { pitched_plans: ["plan_1"], recommended_plan: "plan_1", ...extra.sales_cycle } } : {}) });

test("pasos: día 2 seguimiento4, día 7 procesoafiliacion1, día 30 saludodia2; nunca más de 3", () => {
  assert.equal(nextReactivation(lead(), { lastCustomerAt: ago(1), now }), null, "antes de 2 días nada");
  assert.equal(nextReactivation(lead(), { lastCustomerAt: ago(2.1), now }).template, "seguimiento4");
  const one = { ...lead(), reactivation: { sent: [{ step: 1, template: "seguimiento4", at: ago(5) }] } };
  assert.equal(nextReactivation(one, { lastCustomerAt: ago(6), now }), null, "el paso 2 espera al día 7");
  assert.equal(nextReactivation(one, { lastCustomerAt: ago(8), now }).template, "procesoafiliacion1");
  const oneRecent = { ...lead(), reactivation: { sent: [{ step: 1, template: "seguimiento4", at: ago(1) }] } };
  assert.equal(nextReactivation(oneRecent, { lastCustomerAt: ago(9), now }), null, "al menos 3 días entre envíos");
  const two = { ...lead(), reactivation: { sent: [{ template: "seguimiento4", at: ago(28) }, { template: "procesoafiliacion1", at: ago(23) }] } };
  assert.equal(nextReactivation(two, { lastCustomerAt: ago(31), now }).template, "saludodia2");
  const three = { ...lead(), reactivation: { sent: [{}, {}, {}].map((x, i) => ({ template: "t", at: ago(40 - i) })) } };
  assert.equal(nextReactivation(three, { lastCustomerAt: ago(44), now }), null);
  assert.equal(nextReactivation(lead(), { lastCustomerAt: ago(50), now }), null, "más de 45 días sin escribir: ya no");
});

test("a quien no se le escribe", () => {
  const at = { lastCustomerAt: ago(3), now };
  for (const [memory, reason] of [
    [lead({ sales_cycle: { deferral: "declined" } }), "not_interested"],
    [lead({ sales_cycle: { deferral: "mistake" } }), "not_interested"],
    [lead({ no_contact: { at: ago(3) } }), "no_contact"],
    [lead({ capture_intervention: { active: true } }), "intervened"],
    [lead({ handoff: { status: "assigned" } }), "human"],
  ]) { assert.equal(skipReason(memory), reason); assert.equal(nextReactivation(memory, at), null); }
  assert.ok(nextReactivation(lead({ sales_cycle: { deferral: "no_money" } }), at), "'sin dinero por ahora' sí se reactiva");
  assert.ok(nextReactivation(lead({ handoff: { status: "completed" } }), at), "con la persona ya terminada sí");
});

test("ya aceptó: recordatorio1 una vez si faltan documentos (1 a 7 días)", () => {
  const accepted = { sales_cycle: { authorized: true }, operations: { documents_complete: false } };
  assert.equal(nextReactivation(accepted, { lastCustomerAt: ago(0.5), now }), null);
  assert.equal(nextReactivation(accepted, { lastCustomerAt: ago(1.5), now }).template, "recordatorio1");
  assert.equal(nextReactivation({ ...accepted, reactivation: { docs_reminder_at: ago(1) } }, { lastCustomerAt: ago(2), now }), null);
  assert.equal(nextReactivation({ ...accepted, operations: { documents_complete: true } }, { lastCustomerAt: ago(2), now }), null);
});

test("el día que dijo que retomaba", () => {
  assert.equal(resumeDate("Mejor en la quincena", "2026-11-05T18:00:00Z"), "2026-11-15");
  assert.equal(resumeDate("en la quincena te aviso", "2026-11-18T18:00:00Z"), "2026-11-30");
  assert.equal(resumeDate("la próxima semana", "2026-11-05T18:00:00Z"), "2026-11-12");
  assert.equal(resumeDate("el lunes", "2026-11-05T18:00:00Z"), "2026-11-09", "jueves 5 → lunes 9");
  assert.equal(resumeDate("el 1 de diciembre empiezo", "2026-11-05T18:00:00Z"), "2026-12-01");
  assert.equal(resumeDate("mañana", "2026-11-05T18:00:00Z"), "2026-11-06");
  assert.equal(resumeDate("ahorita no tengo dinero", "2026-11-05T18:00:00Z"), null);
  const deferred = lead({ sales_cycle: { deferral: "later", deferral_resume_date: "2026-11-30" } });
  assert.equal(nextReactivation(deferred, { lastCustomerAt: ago(5), now }), null, "antes de la fecha no");
  const on = new Date("2026-11-30T17:00:00Z");
  assert.equal(nextReactivation(deferred, { lastCustomerAt: new Date(on.getTime() - 12 * DAY).toISOString(), now: on }).reason, "dijo que retomaba el 2026-11-30");
});

test("'no me escriban' y respuesta a la plantilla", () => {
  assert.equal(asksNoContact("Ya no me manden mensajes por favor"), true);
  assert.equal(asksNoContact("No me escriban"), true);
  assert.equal(asksNoContact("Stop"), true);
  assert.equal(asksNoContact("no me han escrito"), false);
  const m = { sales_cycle: { recommended_plan: "plan_1" }, reactivation: { sent: [{ template: "seguimiento3" }], awaiting_reply: true } };
  assert.match(reactivationReplyDecision(m, "Sí, todavía me interesa").reply, /Plan 1 cuesta \$1,100.*¿Quieres que iniciemos tu trámite\?$/s);
  assert.match(reactivationReplyDecision({ reactivation: m.reactivation }, "Hola").reply, /Responde con el número/, "sin plan: el menú");
  assert.equal(reactivationReplyDecision(m, "¿Cuánto cuesta?"), null, "una pregunta la contesta Mia normal");
  assert.equal(reactivationReplyDecision(m, "No gracias"), null);
  assert.equal(reactivationReplyDecision({ ...m, reactivation: { ...m.reactivation, awaiting_reply: false } }, "Sí"), null);
});

test("servicio: apagado no manda; encendido respeta horario, tope diario y asignado a persona", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-react-"));
  const settings = new OpsSettingsStore(path.join(dir, "s.json"), path.join(dir, "i.bin"));
  const mem = { 1: { id: 1, nombre: "Rosa", ...lead() }, 2: { id: 2, nombre: "Luis", ...lead() }, 3: { id: 3, nombre: "Memo", ...lead() }, 4: { id: 4, ...lead({ sales_cycle: { deferral: "declined" } }) } };
  const events = { get: id => [{ timestamp: ago(3), details: { customer_text: "hola" } }], recorded: [], async record(id, type, d) { this.recorded.push({ id, type, d }); } };
  const sent = [];
  const service = new ReactivationService({
    memories: { list: () => Object.values(mem), get: id => mem[id], async merge(id, patch) { mem[id] = { ...mem[id], ...patch }; } },
    inspectorEvents: events,
    templates: { async sendNamed(id, name) { sent.push([id, name]); return { sent: true, name }; } },
    chatwoot: { async getConversation(id) { return { meta: { assignee: { id: id === 3 ? 62 : 53 } } }; } },
    settings, miaAgentId: 53,
  });
  assert.equal((await service.tick(now)).reason, "disabled", "empieza apagada");
  assert.equal(settings.reactivation().enabled, false);
  settings.setReactivation({ enabled: true, daily_cap: 1 }, { username: "sofi" });
  assert.equal((await service.tick(new Date("2026-11-20T03:00:00Z"))).reason, "hours", "de noche no");
  assert.deepEqual(await service.tick(now), { sent: 1 }, "tope 1 al día");
  assert.deepEqual(sent, [[1, "seguimiento4"]]);
  assert.equal(mem[1].reactivation.awaiting_reply, true);
  assert.match(mem[1].ultima_respuesta_agente, /Ha tenido alguna duda o comentario/);
  assert.equal(events.recorded[0].type, "reactivation_sent");
  assert.deepEqual(await service.tick(now), { sent: 0 }, "ya se llegó al tope de hoy");
  settings.setReactivation({ daily_cap: 50 });
  await service.tick(now);
  assert.deepEqual(sent.map(x => x[0]), [1, 2], "Memo está con una persona (62) y a 4 no le interesa");
  assert.throws(() => settings.setReactivation({ daily_cap: 0 }), /tope/);
});

import { WhatsAppTemplates } from "../src/chatwoot/whatsapp-templates.js";
test("plantilla por nombre: solo aprobadas y sincronizadas en el inbox", async () => {
  const sent = [];
  const t = new WhatsAppTemplates({ inboxId: 7, chatwoot: {
    async getInbox() { return { content_templates: { templates: [{ friendly_name: "seguimiento4", language: "es_MX", status: "approved", category: "marketing", body: "Buen día…" }, { friendly_name: "planes", status: "pending" }] } }; },
    async sendTemplate(id, p) { sent.push({ id, ...p }); },
  } });
  assert.deepEqual(await t.sendNamed(5, "seguimiento4"), { sent: true, name: "seguimiento4" });
  assert.deepEqual(sent[0], { id: 5, content: "Buen día…", name: "seguimiento4", language: "es_MX", category: "marketing" });
  assert.equal((await t.sendNamed(5, "planes")).reason, "template_not_synced");
});

// 6-nov: seguimiento4 reemplaza a seguimiento3 (día 2 y plantilla de 24 h).
test("seguimiento4: si ya salió como plantilla de 24 h no se repite; 'Sí' es que tiene una duda", () => {
  const after24h = { ...lead(), reengage_template_at: ago(2) };
  const next = nextReactivation(after24h, { lastCustomerAt: ago(3), now });
  assert.equal(next, null, "ya salió seguimiento4: el siguiente es procesoafiliacion1 al día 7");
  assert.equal(nextReactivation(after24h, { lastCustomerAt: ago(7.2), now })?.template, undefined, "3 días de espera desde la plantilla");
  const later = { ...lead(), reengage_template_at: ago(5) };
  assert.equal(nextReactivation(later, { lastCustomerAt: ago(7.2), now })?.template, "procesoafiliacion1");
  const afterStep2 = { ...later, reactivation: { sent: [{ step: 2, template: "procesoafiliacion1", at: ago(8) }] } };
  assert.equal(nextReactivation(afterStep2, { lastCustomerAt: ago(31), now })?.template, "saludodia2");
  // Plantilla de 24 h de antes de que volviera a escribir: no cuenta.
  assert.equal(nextReactivation({ ...lead(), reengage_template_at: ago(10) }, { lastCustomerAt: ago(2.1), now })?.template, "seguimiento4");

  const m = { sales_cycle: { recommended_plan: "plan_1" }, reactivation: { sent: [{ step: 1, template: "seguimiento4" }], awaiting_reply: true } };
  const yes = reactivationReplyDecision(m, "Sí");
  assert.match(yes.reply, /^Con gusto te ayudo, cuéntame cuál es tu duda\. Te recuerdo que el Plan 1 cuesta \$1,100/);
  assert.doesNotMatch(yes.reply, /¡Qué gusto!/);
});
