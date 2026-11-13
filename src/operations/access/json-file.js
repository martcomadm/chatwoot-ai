import fs from "node:fs";
import path from "node:path";

// Lectura tolerante y escritura atómica (archivo temporal + rename) para los
// archivos de Operations dentro de NEXT_DATA_DIR.
export function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    console.warn(`No se pudo leer ${file}: ${error.message}`);
    return fallback;
  }
}

export function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
