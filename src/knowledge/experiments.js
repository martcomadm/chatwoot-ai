// Pruebas A/B de mensajes (pedido 4-nov, punto 4 de aprendizaje).
// Supervisión escribe una versión B de un mensaje clave; los chats se reparten mitad y mitad
// (A = texto actual, B = el nuevo) y se mide cuántos contestan, aceptan y completan documentos.
// Al terminar se elige la ganadora: si gana B, queda como texto permanente sin redespliegue.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AD_OPENINGS } from "../sales/ad-openings.js";
import { NEED_MENU_TEXT, NEED_MENU_MARK } from "../sales/need-menu.js";

export const CLOSE_DEFAULT = "¿Quieres que iniciemos tu trámite?";
// Versión B del cierre: pide un paso pequeño y concreto (la CURP) y quita el riesgo de pagar.
export const CLOSE_CURP_B = "Para apartarte un lugar solo necesito tu CURP: con eso empiezo tu trámite hoy, y tú compruebas tu alta en el IMSS antes de pagar. ¿Me la compartes?";

// Mensajes que se pueden probar. "required" son frases que Mia necesita para seguir el flujo.
export const SLOTS = Object.freeze({
  "ad_opening:case_review": { label: "Apertura del anuncio \"revisar mi caso\"", defaultText: AD_OPENINGS.case_review, required: ["en qué año empezaste a cotizar"] },
  "ad_opening:pension": { label: "Apertura del anuncio \"seguir sumando para pensión\"", defaultText: AD_OPENINGS.pension, required: ["en qué año empezaste a cotizar"] },
  "ad_opening:no_imss": { label: "Apertura del anuncio \"no cuento con IMSS\"", defaultText: AD_OPENINGS.no_imss, required: [] },
  // 9-nov (punto 1 para cerrar más): cómo termina la explicación completa del plan.
  "contextual_plan_explanation": { label: "Cierre después de explicar el plan", defaultText: CLOSE_DEFAULT, required: [] },
  "followup:menu": { label: "Segundo seguimiento (menú numerado)", defaultText: NEED_MENU_TEXT, required: [NEED_MENU_MARK, "1", "2", "3"] },
});

const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Reparto estable 50/50 por conversación y prueba.
export function variantFor(experimentId, conversationId) {
  const h = crypto.createHash("sha1").update(`${experimentId}:${conversationId}`).digest();
  return h[0] % 2 === 0 ? "A" : "B";
}

export class ExperimentStore {
  constructor(file) {
    this.file = file;
    this.state = { items: [], overrides: {} };
    try { if (file) this.state = { items: [], overrides: {}, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") console.error("NEXT: no se pudieron leer las pruebas A/B:", error.message); }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  slots() {
    return Object.entries(SLOTS).map(([key, slot]) => ({ key, label: slot.label, default_text: slot.defaultText, current_text: this.state.overrides[key]?.text || slot.defaultText, override: this.state.overrides[key] || null, required: slot.required, active: this.active(key)?.id || null }));
  }
  list() { return this.state.items.map(item => ({ ...item })); }
  active(slot) { return this.state.items.find(item => item.slot === slot && item.status === "active") || null; }

  create({ slot, name, bText }, by = null) {
    const def = SLOTS[slot];
    if (!def) throw new Error("Ese mensaje no se puede probar");
    if (this.active(slot)) throw new Error("Ya hay una prueba activa para ese mensaje");
    const text = String(bText || "").trim();
    if (text.length < 20) throw new Error("Escribe la versión B completa");
    if (text.length > 900) throw new Error("La versión B es muy larga (máximo 900 caracteres)");
    const aText = this.state.overrides[slot]?.text || def.defaultText;
    if (text === aText) throw new Error("La versión B es igual a la actual");
    const missing = def.required.filter(phrase => !norm(text).includes(norm(phrase)));
    if (missing.length) throw new Error(`La versión B debe incluir: ${missing.map(p => `"${p}"`).join(", ")} (Mia lo necesita para seguir la conversación)`);
    const item = { id: crypto.randomUUID(), slot, name: String(name || def.label).trim().slice(0, 120), a_text: aText, b_text: text, status: "active", started_at: new Date().toISOString(), started_by: by };
    this.state.items.push(item);
    this.persist();
    return { ...item };
  }

  // Prueba que arranca sola al desplegar (si nunca ha corrido una con ese texto B para ese mensaje).
  seed({ slot, name, bText }) {
    if (this.active(slot) || this.state.items.some(item => item.slot === slot && item.b_text === bText)) return null;
    try { return this.create({ slot, name, bText }, { username: "mia", name: "Mia (automática)" }); }
    catch (error) { console.error("NEXT: no se pudo iniciar la prueba A/B:", error.message); return null; }
  }

  finish(id, winner, by = null) {
    const item = this.state.items.find(i => i.id === id);
    if (!item || item.status !== "active") throw new Error("Esa prueba no está activa");
    if (!["A", "B"].includes(winner)) throw new Error("Elige la versión ganadora");
    Object.assign(item, { status: "finished", winner, ended_at: new Date().toISOString(), ended_by: by });
    if (winner === "B") this.state.overrides[item.slot] = { text: item.b_text, from_experiment: item.id, at: item.ended_at, by };
    this.persist();
    return { ...item };
  }

  clearOverride(slot) {
    if (!this.state.overrides[slot]) throw new Error("Ese mensaje ya usa el texto original");
    delete this.state.overrides[slot];
    this.persist();
  }

  // Texto que se manda para un mensaje probado. Solo reemplaza el texto estándar (si el
  // mensaje se armó distinto, p. ej. con el precio agregado, no se toca).
  apply(slot, conversationId, reply) {
    const def = SLOTS[slot];
    const value = String(reply || "");
    // Puede venir con el saludo antes ("¡Hola! Soy Mia de MARTCOM. " + texto).
    if (!def || !(value === def.defaultText || value.endsWith(` ${def.defaultText}`))) return null;
    const prefix = value.slice(0, value.length - def.defaultText.length);
    const override = this.state.overrides[slot]?.text || null;
    const exp = this.active(slot);
    if (!exp) return override ? { text: prefix + override, experiment: null } : null;
    const variant = variantFor(exp.id, conversationId);
    return { text: prefix + (variant === "B" ? exp.b_text : exp.a_text), experiment: exp.id, variant };
  }

  // Resultados desde las memorias: cada conversación guarda experiments[id] = { variant, at, replied_at }.
  results(id, memories = []) {
    const out = { A: { sent: 0, replied: 0, accepted: 0, docs: 0 }, B: { sent: 0, replied: 0, accepted: 0, docs: 0 } };
    for (const memory of memories) {
      const e = memory?.experiments?.[id];
      if (!e || !out[e.variant]) continue;
      const r = out[e.variant];
      r.sent++;
      if (e.replied_at) r.replied++;
      if (memory.sales_cycle?.authorized) r.accepted++;
      if (memory.operations?.documents_complete) r.docs++;
    }
    for (const r of Object.values(out)) {
      r.replied_pct = r.sent ? Math.round((r.replied / r.sent) * 100) : null;
      r.accepted_pct = r.sent ? Math.round((r.accepted / r.sent) * 100) : null;
    }
    out.enough = out.A.sent >= 30 && out.B.sent >= 30;
    return out;
  }
}
