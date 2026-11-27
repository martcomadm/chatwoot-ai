import test from "node:test";
import assert from "node:assert/strict";
import { explicitHumanRequest } from "../src/core/human-request.js";

for (const phrase of [
  "Es para otra persona",
  "¿Cuánto cuesta por persona?",
  "Soy una persona independiente",
  "quiero hablar de mi papá, es para otra persona",
  "Quiero que me orienten",
  "Necesito asesoría",
  "¿Qué es un asesor?",
  "Mi esposo es una persona mayor",
]) {
  test(`no transfiere por mencionar persona/asesoría: ${phrase}`, () => {
    assert.equal(explicitHumanRequest(phrase), false);
  });
}

for (const phrase of [
  "Quiero hablar con un humano",
  "quiero hablar con una persona",
  "¿Me pueden comunicar con un asesor?",
  "Pásame con una persona por favor",
  "Comunícame con alguien del equipo",
  "que me atienda un asesor",
  "Quiero atención personal",
  "¿Pueden llamarme?",
  "No quiero hablar con un bot",
  "Prefiero un asesor humano",
]) {
  test(`transfiere ante solicitud explícita de humano: ${phrase}`, () => {
    assert.equal(explicitHumanRequest(phrase), true);
  });
}
