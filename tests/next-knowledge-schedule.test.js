import test from "node:test";
import assert from "node:assert/strict";
import { AiServices } from "../src/ai/services.js";

// En producción AI_SCHEDULE tiene el sábado de 8 a 4; Mia debe decir ese horario, no el fijo.
test("el horario que conoce Mia sale de AI_SCHEDULE", () => {
  const line = new AiServices({}, { schedule: "1-5=7-21;6=8-16" }).knowledge().match(/El horario de atención[^\n]*/)[0];
  assert.equal(line, "El horario de atención (hora del centro de México) es de lunes a viernes de 7:00 a.m. a 9:00 p.m. y sábado de 8:00 a.m. a 4:00 p.m. Los domingos no hay servicio. Si el cliente pregunta por el horario, da exactamente este.");
  assert.doesNotMatch(new AiServices({}, { schedule: "0-6=8-20" }).knowledge(), /p\.m\.\.|Los domingos no hay servicio/);
});

// Desde el 20-oct sábados y domingos también se atiende de 7 a.m. a 9 p.m.
test("horario por defecto: todos los días de 7:00 a.m. a 9:00 p.m.", async () => {
  const { DEFAULT_SCHEDULE, parseSchedule, isOpen } = await import("../src/core/business-hours.js");
  const line = new AiServices({}, { schedule: DEFAULT_SCHEDULE }).knowledge().match(/El horario de atención[^\n]*/)[0];
  assert.equal(line, "El horario de atención (hora del centro de México) es de lunes a domingo de 7:00 a.m. a 9:00 p.m. Si el cliente pregunta por el horario, da exactamente este.");
  const week = parseSchedule(DEFAULT_SCHEDULE);
  // Sábado 24-oct y domingo 25-oct-2026, 8:00 p.m. hora de CDMX (UTC-6) → abierto; 9:30 p.m. → cerrado.
  assert.equal(isOpen(week, new Date("2026-10-25T02:00:00Z"), "America/Mexico_City"), true);
  assert.equal(isOpen(week, new Date("2026-10-26T02:00:00Z"), "America/Mexico_City"), true);
  assert.equal(isOpen(week, new Date("2026-10-26T03:30:00Z"), "America/Mexico_City"), false);
  assert.equal(isOpen(week, new Date("2026-10-25T13:00:00Z"), "America/Mexico_City"), true);
});
