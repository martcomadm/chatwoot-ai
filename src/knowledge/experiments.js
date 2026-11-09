// Pruebas A/B de mensajes (pedido 4-nov, punto 4 de aprendizaje).
// Supervisión escribe una versión B de un mensaje clave; los chats se reparten mitad y mitad
// (A = texto actual, B = el nuevo) y se mide cuántos contestan, aceptan y completan documentos.
// Al terminar se elige la ganadora: si gana B, queda como texto permanente sin redespliegue.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AD_OPENINGS } from "../sales/ad-openings.js";
import { NEED_MENU_TEXT, NEED_MENU_MARK } from "../sales/need-menu.js";
import { directAnswerText } from "../orchestrator/conversation-orchestrator.js";
import { priceObjectionDecision } from "../sales/progressive-disclosure.js";
import { deferralDecision } from "../sales/customer-deferral.js";
import { SCHEDULE_OFFER_MARK } from "../sales/scheduled-start.js";
import { CALL_OFFER_MARK } from "../core/human-request.js";

const answer = key => directAnswerText({ answerKey: key, type: key }) || "";
const PLAN1 = { sales_cycle: { recommended_plan: "plan_1", explained_plans: ["plan_1"] } };

export const CLOSE_DEFAULT = "¿Quieres que iniciemos tu trámite?";
// Versión B del cierre: pide un paso pequeño y concreto (la CURP) y quita el riesgo de pagar.
export const CLOSE_CURP_B = "Para apartarte un lugar solo necesito tu CURP: con eso empiezo tu trámite hoy, y tú compruebas tu alta en el IMSS antes de pagar. ¿Me la compartes?";

// Mensajes que se pueden probar. "required" son frases que Mia necesita para seguir el flujo.
// mode: "exact" = el mensaje es exactamente ese texto (o termina con él); "starts" = empieza con él (se conserva
// lo que sigue); "full" = cualquier mensaje de ese tipo (el texto cambia según el plan o el nombre): la versión B
// lo reemplaza completo y puede usar {plan}, {precio} y {nombre}. 9-nov: más mensajes para probar.
const PLACEHOLDERS = ["{plan}", "{precio}", "{nombre}"];
export const SLOTS = Object.freeze({
  // Aperturas
  "ad_opening:case_review": { group: "Aperturas", label: "Apertura del anuncio \"revisar mi caso\"", defaultText: AD_OPENINGS.case_review, required: ["en qué año empezaste a cotizar"] },
  "ad_opening:pension": { group: "Aperturas", label: "Apertura del anuncio \"seguir sumando para pensión\"", defaultText: AD_OPENINGS.pension, required: ["en qué año empezaste a cotizar"] },
  "ad_opening:no_imss": { group: "Aperturas", label: "Apertura del anuncio \"no cuento con IMSS\"", defaultText: AD_OPENINGS.no_imss, required: [] },
  // Cierre
  "contextual_plan_explanation": { group: "Cierre", label: "Cierre después de explicar el plan", defaultText: CLOSE_DEFAULT, required: [] },
  // Objeciones
  "price_objection": { group: "Objeciones", label: "Objeción de precio (\"está caro\", \"¿descuento?\")", mode: "full", match: /^Entiendo que el precio sea importante para ti/, defaultText: priceObjectionDecision(PLAN1, "esta caro")?.reply || "", required: [] },
  "direct:other_price": { group: "Objeciones", label: "Compara con otro precio (\"me ofrecieron más barato\")", defaultText: answer("other_price"), required: [] },
  "direct:legitimacy": { group: "Objeciones", label: "Duda de fraude / ¿es seguro?", mode: "starts", defaultText: answer("legitimacy"), required: [] },
  "direct:trust": { group: "Objeciones", label: "Desconfianza (\"¿dónde están?\", \"¿cómo confío?\")", mode: "starts", defaultText: answer("trust"), required: [] },
  "direct:drop_guarantee": { group: "Objeciones", label: "\"¿Qué seguridad tengo de que no me den de baja?\"", defaultText: answer("drop_guarantee"), required: [] },
  "customer_deferral:later": { group: "Objeciones", label: "\"Lo pienso\" / \"le aviso\" (despedida)", mode: "full", match: /^Claro[^.]{0,30}, sin problema\. Cuando puedas, escríbeme por aquí/, defaultText: deferralDecision(PLAN1, "lo pienso y le aviso")?.reply || "", required: ["escríbeme por aquí"] },
  "customer_deferral:no_money": { group: "Objeciones", label: "\"No tengo dinero\" (ofrece programar el alta)", mode: "full", match: new RegExp(SCHEDULE_OFFER_MARK.replace(/[?¿]/g, ".") + "$"), defaultText: deferralDecision(PLAN1, "no tengo dinero")?.reply || "", required: [SCHEDULE_OFFER_MARK] },
  // Dudas frecuentes
  "direct:fees": { group: "Dudas frecuentes", label: "\"¿Cobran algo aparte?\" / honorarios", defaultText: answer("fees"), required: [] },
  "direct:requirements": { group: "Dudas frecuentes", label: "\"¿Qué documentos necesito?\"", defaultText: answer("requirements"), required: [] },
  "direct:how_to_start": { group: "Dudas frecuentes", label: "\"¿Cómo le hago para iniciar?\"", defaultText: answer("how_to_start"), required: [] },
  "direct:process_time": { group: "Dudas frecuentes", label: "\"¿Cuánto tarda el alta?\"", defaultText: answer("process_time"), required: [] },
  "direct:payment_method": { group: "Dudas frecuentes", label: "\"¿Cómo se paga?\"", defaultText: answer("payment_method"), required: [] },
  "direct:what_is_martcom": { group: "Dudas frecuentes", label: "\"¿Qué es MARTCOM?\"", defaultText: answer("what_is_martcom"), required: [] },
  "direct:still_covered": { group: "Dudas frecuentes", label: "Ya tiene vigencia con otro gestor", defaultText: answer("still_covered"), required: [SCHEDULE_OFFER_MARK] },
  // Seguimientos
  "followup:plan:0": { group: "Seguimientos", label: "1er seguimiento (20 min) a quien ya vio el plan", mode: "full", match: /^¿Te quedó alguna duda sobre el Plan [12]\? Con gusto te la resuelvo\.$/, defaultText: "¿Te quedó alguna duda sobre el Plan 1? Con gusto te la resuelvo.", required: [] },
  "followup:plan:1": { group: "Seguimientos", label: "2º seguimiento (3 h) a quien ya vio el plan", mode: "full", match: /^Hola de nuevo\. ¿Te gustaría que iniciemos tu trámite con el Plan [12]\?/, defaultText: "Hola de nuevo. ¿Te gustaría que iniciemos tu trámite con el Plan 1? Si tienes alguna duda, con gusto te la resuelvo.", required: [] },
  "followup:plan:2": { group: "Seguimientos", label: "3er seguimiento (20 h): ofrece la llamada", mode: "full", match: /^¿Prefieres que un asesor te llame unos minutos y te explique el Plan [12] con calma\?/, defaultText: "¿Prefieres que un asesor te llame unos minutos y te explique el Plan 1 con calma? Dime sí y a qué hora te queda bien, y te marcamos a este número.", required: [CALL_OFFER_MARK] },
  "followup:menu": { group: "Seguimientos", label: "Segundo seguimiento sin plan (menú numerado)", defaultText: NEED_MENU_TEXT, required: [NEED_MENU_MARK, "1", "2", "3"] },
});

// {plan}, {precio}, {nombre}: del mensaje original (el plan que menciona) y de la memoria.
export function fillPlaceholders(template, original = "", vars = {}) {
  const plan = /Plan 2/.test(original) ? "Plan 2" : /Plan 1/.test(original) ? "Plan 1" : (vars.plan || "plan");
  const precio = plan === "Plan 2" ? "$1,500 MXN mensuales" : plan === "Plan 1" ? "$1,100 MXN mensuales" : "";
  const nombre = String(vars.nombre || "").trim().split(/\s+/)[0] || "";
  return String(template)
    .replace(/\{plan\}/g, `el ${plan}`).replace(/\bel el /g, "el ").replace(/\bde el /g, "del ").replace(/\ba el /g, "al ")
    .replace(/(^|[.!?]\s+|[¿¡])el (Plan|plan)\b/g, (m, p1, p2) => `${p1}El ${p2}`)
    .replace(/\{precio\}/g, precio)
    .replace(/\{nombre\}/g, nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase() : "")
    .replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

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
    return Object.entries(SLOTS).map(([key, slot]) => ({ key, label: slot.label, group: slot.group || "Otros", mode: slot.mode || "exact", match_source: slot.match ? slot.match.source : null, placeholders: slot.mode === "full" ? PLACEHOLDERS : [], default_text: slot.defaultText, current_text: this.state.overrides[key]?.text || slot.defaultText, override: this.state.overrides[key] || null, required: slot.required, active: this.active(key)?.id || null }));
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
  apply(slot, conversationId, reply, vars = {}) {
    const def = SLOTS[slot];
    const value = String(reply || "");
    if (!def || !value) return null;
    const override = this.state.overrides[slot]?.text || null;
    const exp = this.active(slot);
    if (!exp && !override) return null;
    // "full": cualquier mensaje de ese tipo; B (o el ganador) lo reemplaza completo, con {plan}/{precio}/{nombre}.
    if (def.mode === "full") {
      if (!def.match?.test(value)) return null;
      if (!exp) return { text: fillPlaceholders(override, value, vars), experiment: null };
      const variant = variantFor(exp.id, conversationId);
      const a = override ? fillPlaceholders(override, value, vars) : value;
      return { text: variant === "B" ? fillPlaceholders(exp.b_text, value, vars) : a, experiment: exp.id, variant };
    }
    let prefix = "", suffix = "";
    if (def.mode === "starts") {
      if (!value.startsWith(def.defaultText)) return null;
      suffix = value.slice(def.defaultText.length);
    } else {
      // Puede venir con el saludo antes ("¡Hola! Soy Mia de MARTCOM. " + texto).
      if (!(value === def.defaultText || value.endsWith(` ${def.defaultText}`))) return null;
      prefix = value.slice(0, value.length - def.defaultText.length);
    }
    if (!exp) return { text: prefix + override + suffix, experiment: null };
    const variant = variantFor(exp.id, conversationId);
    return { text: prefix + (variant === "B" ? exp.b_text : exp.a_text) + suffix, experiment: exp.id, variant };
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
