import { readFileSync } from "node:fs";

// Fuente única de versiones: el Core sale de package.json para que el header del
// Inspector, /health, / y los logs no vuelvan a desincronizarse.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const CORE_VERSION = pkg.version;
export const INSPECTOR_VERSION = "1.7.0";
