import test from "node:test";
import assert from "node:assert/strict";
import { AiServices } from "../src/ai/services.js";

// En producción AI_SCHEDULE tiene el sábado de 8 a 4; Mia debe decir ese horario, no el fijo.
test("el horario que conoce Mia sale de AI_SCHEDULE", () => {
  const line = new AiServices({}, { schedule: "1-5=7-21;6=8-16" }).knowledge().match(/El horario de atención[^\n]*/)[0];
  assert.equal(line, "El horario de atención (hora del centro de México) es de lunes a viernes de 7:00 a.m. a 9:00 p.m. y sábado de 8:00 a.m. a 4:00 p.m. Los domingos no hay servicio. Si el cliente pregunta por el horario, da exactamente este.");
  assert.doesNotMatch(new AiServices({}, { schedule: "0-6=8-20" }).knowledge(), /p\.m\.\.|Los domingos no hay servicio/);
});
