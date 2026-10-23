import fs from "node:fs";

// Única fuente de versión: package.json. Antes /health, / y el Inspector
// reportaban versiones distintas (3.2.2, 3.3.2.1) y ninguna coincidía.
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const APP_VERSION = pkg.version;
