import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractFast } from "../src/memory/fast-extractor.js";
import { medicalNotNeededDecision } from "../src/sales/progressive-disclosure.js";
import { FollowUpStore, FollowUpService } from "../src/core/follow-up.js";

// Chat real 9-oct 2:14 p.m.: "Dejé de cotizar, quiero seguir sumando para pensionarme" y
// luego "solo me interesa sumar para pensionarme, no me interesa el seguro médico".
// Mia repitió el precio y preguntó si estaba afiliado al IMSS (ya había dicho que no).

test("'Dejé de cotizar' significa que hoy no tiene IMSS activo (y que cotizó antes)", () => {
  for (const text of ["Dejé de cotizar, quiero seguir sumando para pensionarme", "ya no cotizo", "me dieron de baja del imss", "No se cuenta con imss"]) {
    const patch = extractFast(text, {});
    assert.equal(patch.tiene_imss, false, text);
  }
  assert.equal(extractFast("Dejé de cotizar", {}).contexto_laboral.cotizo_anteriormente, true);
});

test("'no me interesa el seguro médico' se aclara sin repetir el precio", () => {
  const memory = { sales_cycle: { recommended_plan: "plan_1", pitched_plans: ["plan_1"] }, commercial_need: { weeks: true, retirement: true } };
  const decision = medicalNotNeededDecision(memory, "Hola, sólo me interesa sumar para pensionarme,no me interesa el seguro médico");
  assert.equal(decision.reply, "Entendido. El Plan 1 es justamente para seguir sumando semanas cotizadas para tu pensión. El servicio médico del IMSS viene incluido en el mismo costo; no se paga aparte y lo usas solo si lo necesitas. ¿Quieres que te explique cómo funciona?");
  assert.doesNotMatch(decision.reply, /\$|afiliad/);
  assert.match(medicalNotNeededDecision({}, "no necesito seguro médico, solo afore e infonavit").reply, /Plan 2/);
  assert.equal(medicalNotNeededDecision({}, "me interesa el seguro médico"), null);
});

// Chat de María Esther: "¿Te quedó alguna duda sobre el Plan 1?" llegó tres veces.
test("un seguimiento que ya se mandó en la conversación no se repite", async () => {
  let memory = { sales_cycle: { recommended_plan: "plan_1" }, followups_sent: ["¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo."] };
  const sent = [];
  const T0 = new Date("2026-10-12T16:00:00Z");
  const conversation = { id: 5, inbox_id: 7, status: "open", labels: [], meta: { assignee: { id: 53 } }, messages: [] };
  const service = new FollowUpService({
    store: new FollowUpStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "next-fu2-")), "f.json")),
    chatwoot: { async getConversation() { return structuredClone(conversation); }, async sendMessage(_id, text) { sent.push(text); } },
    labels: { async mergeSafe() {} },
    memories: { get: () => structuredClone(memory), async set(_id, m) { memory = m; } },
    config: { chatwoot: { inboxId: 7, agentId: 53 } },
  });
  service.afterReply(5, { customerAt: T0, now: T0 });
  await service.tick(new Date(T0.getTime() + 20 * 60 * 1000));
  assert.match(sent[0], /^Hola de nuevo\. ¿Te gustaría que iniciemos tu trámite con el Plan 1\?/);
  assert.equal(memory.followups_sent.length, 2);
  // Si ya se usaron todos los mensajes, no se manda nada.
  memory.followups_sent = [0, 1, 2].map(k => ["¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo.", "Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el Plan 1? Si tienes alguna duda, con gusto te la resuelvo.", "Te escribo para saber si aún te interesa el Plan 1. Si quieres iniciar o tienes alguna pregunta, aquí estoy para ayudarte."][k]);
  service.afterReply(5, { customerAt: T0, now: T0 });
  await service.tick(new Date(T0.getTime() + 20 * 60 * 1000));
  assert.equal(sent.length, 1);
});
