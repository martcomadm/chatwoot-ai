// Respuestas de Mia editables por el equipo (pedido 4-nov).
// Supervisión y Admin agregan o corrigen respuestas desde Operations y Mia las usa al momento,
// sin redespliegue:
// - Siempre entran en las instrucciones de la IA como "respuestas aprobadas por el equipo".
// - Si la respuesta tiene "frases del cliente", cuando el mensaje del cliente contiene una de
//   ellas se contesta con ese texto exacto (antes que la IA).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function normText(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPhrases(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,;]+/);
  return [...new Set(list.map(item => String(item || "").trim()).filter(item => normText(item).length >= 4))].slice(0, 20);
}

export class TeamAnswerStore {
  constructor(file) {
    this.file = file;
    this.items = [];
    try { if (file) this.items = JSON.parse(fs.readFileSync(file, "utf8"))?.items || []; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudieron leer las respuestas del equipo:", error.message); }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() { return this.items.map(item => ({ ...item })); }
  active() { return this.items.filter(item => item.active !== false); }
  get(id) { return this.items.find(item => item.id === id) || null; }

  validate({ topic, answer }) {
    const t = String(topic || "").trim();
    const a = String(answer || "").trim();
    if (t.length < 3) throw new Error("Escribe el tema o la pregunta del cliente");
    if (a.length < 10) throw new Error("Escribe la respuesta que debe dar Mia");
    if (a.length > 900) throw new Error("La respuesta es muy larga (máximo 900 caracteres)");
    return { topic: t.slice(0, 200), answer: a };
  }

  create(input = {}, by = null) {
    const base = this.validate(input);
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      ...base,
      phrases: cleanPhrases(input.phrases),
      active: input.active !== false,
      source: input.source === "learned" ? "learned" : "manual",
      learned_from: input.learned_from || null,
      created_by: by, created_at: now, updated_by: by, updated_at: now,
    };
    this.items.push(item);
    this.persist();
    return { ...item };
  }

  update(id, input = {}, by = null) {
    const item = this.get(id);
    if (!item) throw new Error("No existe esa respuesta");
    const base = this.validate({ topic: input.topic ?? item.topic, answer: input.answer ?? item.answer });
    Object.assign(item, base, {
      phrases: input.phrases === undefined ? item.phrases : cleanPhrases(input.phrases),
      active: input.active === undefined ? item.active : input.active !== false,
      updated_by: by, updated_at: new Date().toISOString(),
    });
    this.persist();
    return { ...item };
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(item => item.id !== id);
    if (this.items.length === before) throw new Error("No existe esa respuesta");
    this.persist();
  }

  // Respuesta exacta cuando el mensaje contiene una frase configurada (la más larga gana).
  match(text = "") {
    const v = ` ${normText(text)} `;
    if (v.trim().length < 3) return null;
    let best = null;
    for (const item of this.active()) {
      for (const phrase of item.phrases || []) {
        const p = normText(phrase);
        if (p && v.includes(` ${p} `) && (!best || p.length > best.length)) best = { item, length: p.length, phrase };
      }
    }
    return best ? { ...best.item, matched_phrase: best.phrase } : null;
  }

  // Bloque para las instrucciones de la IA.
  promptBlock() {
    const active = this.active();
    if (!active.length) return "";
    return [
      "RESPUESTAS APROBADAS POR EL EQUIPO DE MARTCOM (fuente de verdad, más reciente que lo anterior; si algo se contradice, manda esto). Cuando el cliente pregunte por uno de estos temas, responde con esa información, con tu estilo y sin cambiar ningún dato:",
      ...active.map(item => `- Tema: ${item.topic}\n  Respuesta: ${item.answer.replace(/\s+/g, " ")}`),
    ].join("\n");
  }
}
