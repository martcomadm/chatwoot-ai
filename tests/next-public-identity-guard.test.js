import test from "node:test";
import assert from "node:assert/strict";
import { stripRepeatedPublicPresentation } from "../src/core/public-identity-guard.js";

test("removes repeated Soy Mia presentation", () => {
  assert.equal(
    stripRepeatedPublicPresentation("Soy Mia de MARTCOM. Para seguir cotizando semanas puedo explicarte las opciones.", "Mia de MARTCOM"),
    "Para seguir cotizando semanas puedo explicarte las opciones."
  );
});

test("removes repeated Hola soy Mia presentation", () => {
  assert.equal(
    stripRepeatedPublicPresentation("Hola, soy Mia de MARTCOM. Claro, continuamos.", "Mia de MARTCOM"),
    "Claro, continuamos."
  );
});

test("does not alter normal follow-up", () => {
  assert.equal(
    stripRepeatedPublicPresentation("Entiendo, Juan. Si tu objetivo es seguir cotizando semanas, revisemos esa opción.", "Mia de MARTCOM"),
    "Entiendo, Juan. Si tu objetivo es seguir cotizando semanas, revisemos esa opción."
  );
});
