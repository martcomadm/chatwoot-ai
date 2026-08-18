import fs from "node:fs";
import assert from "node:assert/strict";

const js=fs.readFileSync(new URL("../src/inspector/public/inspector.js",import.meta.url),"utf8");
assert.match(js,/controlBtn'\)\.addEventListener\('click'/);
assert.match(js,/closeControl'\)\.addEventListener\('click'/);
assert.match(js,/loadControl'\)\.addEventListener\('click'/);
assert.match(js,/controlBody'\)\.addEventListener\('click'/);
assert.match(js,/document\.querySelectorAll\('\[data-range\]'\)/);
assert.match(js,/fromDate','toDate','sort/);
console.log("Inspector V1.4.1 frontend regression OK");
