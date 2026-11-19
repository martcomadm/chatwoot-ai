import test from "node:test";
import assert from "node:assert/strict";
import { ExperimentStore, SLOTS, fillPlaceholders, variantFor } from "../src/knowledge/experiments.js";
import { directAnswerText } from "../src/orchestrator/conversation-orchestrator.js";
import { deferralDecision } from "../src/sales/customer-deferral.js";
import { priceObjectionDecision } from "../src/sales/progressive-disclosure.js";

// 9-nov: más mensajes para probar en A/B (objeciones, dudas frecuentes, seguimientos).
const bId = (exp, want) => { for (let id = 1; id < 200; id++) if (variantFor(exp.id, id) === want) return id; };

test("hay mensajes de cada grupo y los textos A son los reales", () => {
  const groups = new Set(Object.values(SLOTS).map(s => s.group));
  for (const g of ["Aperturas", "Cierre", "Objeciones", "Dudas frecuentes", "Seguimientos"]) assert.ok(groups.has(g), g);
  assert.equal(SLOTS["direct:fees"].defaultText, directAnswerText({ answerKey: "fees", type: "fees" }));
  for (const [k, s] of Object.entries(SLOTS)) assert.ok(s.defaultText.length > 10, k);
});

test("modo exacto (respuesta fija) y 'empieza con' (se conserva lo que sigue)", () => {
  const exp = new ExperimentStore(null);
  const fees = exp.create({ slot: "direct:fees", bText: "Solo pagas tu mensualidad: $1,100 MXN (Plan 1) o $1,500 MXN (Plan 2), sin costos extra. ¿Iniciamos?" });
  const text = SLOTS["direct:fees"].defaultText;
  assert.match(exp.apply("direct:fees", bId(fees, "B"), text).text, /^Solo pagas tu mensualidad/);
  assert.equal(exp.apply("direct:fees", bId(fees, "A"), text).text, text);
  const leg = exp.create({ slot: "direct:legitimacy", bText: "Te entiendo, hay mucho fraude. Por eso primero haces tu alta, la compruebas en IMSS Digital y después pagas." });
  const suffix = " Si prefieres que una persona te atienda y resuelva tus dudas, ¿quieres que te comunique con un asesor?";
  const out = exp.apply("direct:legitimacy", bId(leg, "B"), SLOTS["direct:legitimacy"].defaultText + suffix).text;
  assert.ok(out.startsWith("Te entiendo, hay mucho fraude") && out.endsWith(suffix));
});

test("modo completo: precio y 'lo pienso' con {plan}, {precio} y {nombre}", () => {
  const exp = new ExperimentStore(null);
  const p = exp.create({ slot: "price_objection", bText: "Te entiendo {nombre}. {plan} cuesta {precio} y primero compruebas tu alta antes de pagar. ¿Te explico qué incluye?" });
  const plan2 = priceObjectionDecision({ sales_cycle: { recommended_plan: "plan_2" } }, "está caro").reply;
  assert.equal(exp.apply("price_objection", bId(p, "B"), plan2, { nombre: "maria lopez" }).text, "Te entiendo Maria. El Plan 2 cuesta $1,500 MXN mensuales y primero compruebas tu alta antes de pagar. ¿Te explico qué incluye?");
  assert.equal(exp.apply("price_objection", bId(p, "B"), plan2, {}).text, "Te entiendo. El Plan 2 cuesta $1,500 MXN mensuales y primero compruebas tu alta antes de pagar. ¿Te explico qué incluye?");
  assert.equal(exp.apply("price_objection", bId(p, "A"), plan2).text, plan2);
  assert.equal(exp.apply("price_objection", 1, "Otra cosa"), null);
  assert.throws(() => exp.create({ slot: "customer_deferral:later", bText: "Claro, aquí sigo cuando quieras, sin prisa." }), /escríbeme por aquí/);
  const later = exp.create({ slot: "customer_deferral:later", bText: "Claro {nombre}, tómate tu tiempo. Si te ayuda, te mando un resumen de {plan}. Cuando quieras, escríbeme por aquí." });
  const original = deferralDecision({ sales_cycle: { recommended_plan: "plan_1" }, nombre: "Rosa" }, "lo pienso").reply;
  assert.match(exp.apply("customer_deferral:later", bId(later, "B"), original, { nombre: "Rosa", plan: "Plan 1" }).text, /^Claro Rosa, tómate tu tiempo\. Si te ayuda, te mando un resumen del Plan 1/);
  assert.equal(fillPlaceholders("{plan} {precio}", "nada"), "El plan", "sin plan conocido");
});

test("seguimientos con plan: se aplica el del paso que toca", () => {
  const exp = new ExperimentStore(null);
  const e = exp.create({ slot: "followup:plan:2", bText: "{nombre}, ¿prefieres que un asesor te llame 5 minutos para resolver tus dudas de {plan}? Dime sí y a qué hora." });
  const step2 = "¿Prefieres que un asesor te llame unos minutos y te explique el Plan 2 con calma? Dime sí y a qué hora te queda bien, y te marcamos a este número.";
  assert.equal(exp.apply("followup:plan:2", bId(e, "B"), step2, { nombre: "Luis" }).text, "Luis, ¿prefieres que un asesor te llame 5 minutos para resolver tus dudas del Plan 2? Dime sí y a qué hora.");
  assert.equal(exp.apply("followup:plan:0", bId(e, "B"), step2), null);
  assert.throws(() => new ExperimentStore(null).create({ slot: "followup:plan:2", bText: "¿Quieres que te marquemos? Dime a qué hora." }), /prefieres que un asesor te llame/);
});
