import fs from "node:fs";

// Inspector de Mia (Admin). HTML, CSS y JS en archivos separados, ensamblados una vez.
const read = name => fs.readFileSync(new URL(`./mia-ui/${name}`, import.meta.url), "utf8");
let cached = null;

export function miaInspectorPage() {
  if (cached) return cached;
  cached = read("mia.html")
    .replace("/*__MIA_CSS__*/", () => read("mia.css"))
    .replace("/*__MIA_JS__*/", () => read("mia.client.js"));
  return cached;
}
