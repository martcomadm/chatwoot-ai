import fs from "node:fs";

// Página única de Operations. El HTML, CSS y JS viven en archivos separados para
// poder editarlos con facilidad; aquí solo se ensamblan una vez al arrancar.
const read = name => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

let cached = null;

export function operationsAppPage() {
  if (cached) return cached;
  cached = read("app.html")
    .replace("/*__APP_CSS__*/", () => read("app.css"))
    .replace("/*__APP_JS__*/", () => read("app.client.js"));
  return cached;
}
