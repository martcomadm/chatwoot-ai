import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATE_CATALOG, templateByName, templatesFor } from "../src/chatwoot/template-catalog.js";
import { TEMPLATE_TEXTS } from "../src/chatwoot/whatsapp-templates.js";

// Catálogo de plantillas aprobadas (Twilio, 5-nov).
test("catálogo de plantillas: nombres únicos, SID de Twilio y categoría válida", () => {
  assert.equal(TEMPLATE_CATALOG.length, 12);
  assert.equal(new Set(TEMPLATE_CATALOG.map(t => t.name)).size, 12);
  for (const t of TEMPLATE_CATALOG) {
    assert.match(t.sid, /^HX[0-9a-f]{32}$/, t.name);
    assert.ok(["marketing", "utility"].includes(t.category), t.name);
  }
  assert.ok(templatesFor("reactivation").every(t => t.category === "marketing"), "reactivar solo con Marketing");
  assert.equal(templateByName("vigencia1").text, TEMPLATE_TEXTS.validity);
  assert.equal(templateByName("recomendacion2").text, TEMPLATE_TEXTS.referral);
});
