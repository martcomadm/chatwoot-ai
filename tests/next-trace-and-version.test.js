import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { trace, traceEnabled } from "../src/utils/debug-trace.js";
import { APP_VERSION } from "../src/version.js";

function captureLogs(fn) {
  const original = console.log; const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try { fn(); } finally { console.log = original; }
  return lines;
}

test("INE TRACE solo se imprime con DEBUG_TRACE activo", () => {
  const previous = process.env.DEBUG_TRACE;
  try {
    delete process.env.DEBUG_TRACE;
    assert.equal(traceEnabled(), false);
    assert.deepEqual(captureLogs(() => trace("webhook", { a: 1 })), []);
    process.env.DEBUG_TRACE = "1";
    assert.equal(traceEnabled(), true);
    assert.deepEqual(captureLogs(() => trace("webhook", { a: 1 })), ['INE TRACE webhook {"a":1}']);
  } finally {
    if (previous === undefined) delete process.env.DEBUG_TRACE; else process.env.DEBUG_TRACE = previous;
  }
});

test("la versión reportada sale de package.json y no hay versiones fijas en routes", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(APP_VERSION, pkg.version);
  const routes = fs.readFileSync(new URL("../src/routes.js", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /version:\s*"\d/);
});

test(".env.next.example documenta todas las variables que lee el código", () => {
  const example = fs.readFileSync(new URL("../.env.next.example", import.meta.url), "utf8");
  const files = fs.readdirSync(new URL("../src/", import.meta.url), { recursive: true }).filter(f => f.endsWith(".js"));
  const used = new Set();
  for (const file of files) {
    const src = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    for (const match of src.matchAll(/process\.env\.([A-Z_]+)/g)) used.add(match[1]);
  }
  const missing = [...used].filter(name => !example.includes(name));
  assert.deepEqual(missing, []);
});
