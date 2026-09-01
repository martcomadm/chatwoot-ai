import fs from "node:fs";
import assert from "node:assert/strict";

const src=fs.readFileSync(new URL("../src/core/conversation-processor.js",import.meta.url),"utf8");
assert.doesNotMatch(src,/resolveNegationScope\(joined\)/);
assert.match(src,/resolveNegationScope\(/);
console.log("V3.3.2.1 negation hotfix regression OK");
