import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const js = fs.readFileSync(new URL("../src/inspector/public/inspector.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/inspector/page.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function functionSource(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `no existe ${name}()`);
  let depth = 0;
  for (let i = js.indexOf("{", start); i < js.length; i += 1) {
    if (js[i] === "{") depth += 1;
    if (js[i] === "}" && --depth === 0) return js.slice(start, i + 1);
  }
  throw new Error(`no se pudo leer ${name}()`);
}

function load(...names) {
  const ctx = {};
  vm.runInNewContext(names.map(functionSource).join("\n"), ctx);
  return ctx;
}

test("setRange no registra listeners (antes se duplicaban en cada clic de fecha)", () => {
  const body = functionSource("setRange");
  assert.doesNotMatch(body, /addEventListener/);
  assert.match(body, /refreshAll\(\)/, "los botones de fecha deben seguir recargando");
});

test("cada listener del Control Center se registra una sola vez", () => {
  for (const pattern of [
    "addEventListener('drop'",
    "addEventListener('dragstart'",
    "advisorModalList').addEventListener('click'",
    "closeAdvisorModal').addEventListener('click'",
    "advisorSearch').addEventListener('input'",
  ]) {
    assert.equal(js.split(pattern).length - 1, 1, pattern);
  }
});

test("esc escapa comillas para usarse en atributos", () => {
  const { esc } = load("esc");
  assert.equal(esc(`a"b'c<d>&`), "a&quot;b&#39;c&lt;d&gt;&amp;");
  assert.equal(esc(null), "No informado");
});

test("rotationFor lee el array de rotationOverview()", () => {
  const { rotationFor } = load("rotationFor");
  const rotations = [
    { group: "weekday", nextAgent: { name: "Wendy" }, lastAgentName: "Susana" },
    { group: "sunday", nextAgent: null, lastAgentName: null },
  ];
  assert.equal(rotationFor(rotations, "weekday").nextAgent.name, "Wendy");
  assert.equal(rotationFor(rotations, "weekday").lastAgentName, "Susana");
  assert.equal(Object.keys(rotationFor(rotations, "saturday")).length, 0);
});

test("los confirm usan saltos de línea reales, no \\\\n literal", () => {
  assert.doesNotMatch(js, /\\\\n/);
});

test("no queda código muerto de la UI anterior", () => {
  assert.doesNotMatch(js, /agentsFromEditor|copyMasterAgent|moveAgentBetweenGroups|copyAgentBetweenGroups/);
});

test("Control Operativo valida el token admin y protege cambios sin guardar", () => {
  assert.match(functionSource("loadControl"), /control\/admin-check/);
  assert.match(functionSource("saveCurrentRotation"), /confirmDiscard\(group\)/);
  for (const name of ["dynamicMove", "dynamicCopy", "removeFromCurrentGroup", "deleteMasterAdvisor", "createAdvisorFromModal"]) {
    assert.match(functionSource(name), /confirmDiscard\(\)/, name);
  }
});

test("el header del Inspector toma las versiones de version.js", async () => {
  assert.doesNotMatch(page, /Inspector 1\.5\.2|Core 3\.3\.0/);
  const { inspectorPage } = await import("../src/inspector/page.js");
  assert.match(inspectorPage(), new RegExp(`Core ${pkg.version.replace(/\./g, "\\.")}`));
});
