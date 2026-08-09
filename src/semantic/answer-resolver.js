import { extractValidatedName } from "./name-validator.js";
import { normalizeEmployment } from "./normalizer.js";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function shortYesNo(text) {
  const value = normalized(text).replace(/[^a-z]/g, "");
  if (["si","siii","siiii","correcto","exacto"].includes(value)) return true;
  if (["no","noo","nooo","nop","noup"].includes(value)) return false;
  return null;
}

function ageFromReply(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/\b(1[89]|[2-9]\d)\b/);
  if (!match) return null;
  const age = Number(match[1]);
  return age >= 18 && age <= 99 ? age : null;
}

export function resolveAnswer(text, memory = {}) {
  const key = memory?.ultima_pregunta || memory?.flujo?.siguiente_paso || null;
  const patch = {};
  const resolved = [];
  const events = [];
  if (!key) return { patch, resolved, events };

  if (key === "edad") {
    const age = ageFromReply(text);
    if (age) {
      patch.edad = age;
      resolved.push("edad");
      events.push({ field: "edad", value: age, rule: "answer_to_last_question" });
    }
  }

  if (key === "nombre") {
    const name = extractValidatedName(text, memory);
    if (name) {
      patch.nombre = name;
      patch.primer_nombre = name.split(/\s+/)[0];
      resolved.push("nombre");
      events.push({ field: "nombre", value: name, rule: "answer_to_last_question" });
    }
  }

  if (key === "actividad") {
    const job = normalizeEmployment(text);
    if (job) {
      patch.actividad = job.value;
      patch.tipo_trabajo = job.value;
      resolved.push("actividad");
      events.push({ field: "actividad", value: job.value, rule: job.rule });
    } else if (String(text ?? "").trim().length >= 3 && String(text).trim().length <= 120) {
      patch.actividad = String(text).trim();
      resolved.push("actividad");
      events.push({ field: "actividad", value: patch.actividad, rule: "free_activity_answer" });
    }
  }

  if (["tiene_imss","afiliado_imss_al_fallecer","afore_contactada"].includes(key)) {
    const answer = shortYesNo(text);
    if (answer !== null) {
      if (key === "tiene_imss") patch.tiene_imss = answer;
      if (key === "afiliado_imss_al_fallecer") patch.caso_fallecimiento = { afiliado_imss_al_fallecer: answer };
      if (key === "afore_contactada") patch.caso_fallecimiento = { afore_contactada: answer };
      resolved.push(key);
      events.push({ field: key, value: answer, rule: "short_yes_no_bound_to_last_question" });
    }
  }

  if (key === "nss") {
    const low = normalized(text);
    if (/no tengo nss|no tengo numero|no cuento con nss/.test(low)) {
      patch.slots = { nss_disponible: false };
      resolved.push("nss_disponibilidad");
      if (/curp/.test(low)) patch.slots.curp_disponible = true;
    }
  }

  return { patch, resolved, events };
}
