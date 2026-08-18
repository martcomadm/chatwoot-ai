import fs from "node:fs";
import assert from "node:assert/strict";

const js = fs.readFileSync(new URL("../src/inspector/public/inspector.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/inspector/page.js", import.meta.url), "utf8");

assert.match(js, /DOMContentLoaded/);
assert.match(js, /sessionStorage/);
assert.match(js, /refreshBtn/);
assert.doesNotMatch(page, /onclick=/);
assert.match(page, /inspector\/assets\/inspector\.js/);

console.log("Inspector frontend tests OK");
