import test from "node:test";
import assert from "node:assert/strict";
import { adOpeningKind, adOpeningDecision, AD_OPENINGS } from "../src/sales/ad-openings.js";
import { detectDirectRequest, directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { compactPlanRecommendation } from "../src/sales/progressive-disclosure.js";
import { MARTCOM_KNOWLEDGE } from "../src/knowledge/martcom.js";

test("cada mensaje automático de los anuncios recibe su primera respuesta", () => {
  assert.equal(adOpeningKind("Dejé de cotizar, quiero seguir sumando para pensionarme"), "pension");
  assert.equal(adOpeningKind("Quiero seguir cotizando en el seguro"), "pension");
  assert.equal(adOpeningKind("Información y revisar mi caso con mi NSS"), "case_review");
  assert.equal(adOpeningKind("NO cuento con IMSS y quiero afiliarme."), "no_imss");
  assert.equal(adOpeningKind("Comenzar con mi afiliación al IMSS"), "no_imss");
  assert.equal(adOpeningKind("Ya estoy afiliado al IMSS actualmente."), "already_affiliated");
  assert.equal(adOpeningKind("¿Dejé de cotizar, puedo seguir?"), null, "una pregunta la contesta la regla que corresponda");
  assert.match(adOpeningDecision({}, "Dejé de cotizar, quiero seguir sumando para pensionarme").reply, /revisar tu caso/);
  assert.equal(adOpeningDecision({ ultima_respuesta_agente: "x" }, "Dejé de cotizar, quiero seguir sumando para pensionarme"), null, "solo la primera respuesta");
  assert.doesNotMatch(AD_OPENINGS.pension, /\$/, "el anuncio de pensión no arranca con precio");
});

test("anuncio 'Seguro Social Integral': Mia aclara que no es el IMSS", () => {
  for (const t of ["¿Ustedes son del IMSS?", "¿Estoy hablando con el IMSS?", "¿Son de gobierno?"]) assert.equal(detectDirectRequest(t)?.type, "are_you_imss", t);
  assert.match(directAnswerText({ answerKey: "are_you_imss" }), /^No, no somos el IMSS/);
  assert.match(MARTCOM_KNOWLEDGE, /no prometas atención médica sin citas/);
});

test("pensión: si empezó a cotizar antes de 1997, el primer plan menciona Ley 73 y los 13 meses", () => {
  const d = compactPlanRecommendation({ commercial_need: { weeks: true, retirement: true }, pension_data: { cotizo_antes_1997: true } }, "Hace 5 años, desde el 92");
  assert.match(d.reply, /Ley 73: necesitas al menos 13 meses/);
});
