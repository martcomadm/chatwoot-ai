import { extractValidatedName } from "./name-validator.js";
import { normalizeEmployment } from "./normalizer.js";
import { extractAge } from "./age-extractor.js";
import { normalizeCurp } from "./curp-normalizer.js";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function shortYesNo(text) {
  const value = normalized(text).replace(/[^a-z]/g, "");
  if (["si","siii","siiii","correcto","exacto"].includes(value)) return true;
  if (["no","noo","nooo","nop","noup"].includes(value)) return false;
  return null;
}


export function resolveAnswer(text, memory = {}) {
  const key = memory?.ultima_pregunta || memory?.flujo?.siguiente_paso || null;
  const patch = {};
  const resolved = [];
  const events = [];
  if (!key) return { patch, resolved, events };

  if (key === "edad") {
    const age = extractAge(text, memory);
    if (age) {
      patch.edad = age.value;
      resolved.push("edad");
      events.push({ field: "edad", value: age.value, rule: age.rule });
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
    let answer = shortYesNo(text);
    let rule = "short_yes_no_bound_to_last_question";
    const low = normalized(text);
    if (key === "tiene_imss" && answer === null) {
      if (/(?:si|sí)?\s*(?:tengo|cuento con|tengo el|tengo la).{0,22}(?:imss|seguro|servicio)|(?:estoy|sigo)\s+(?:dado de alta|afiliado)/.test(low)
          && !/(?:no tengo|no cuento|sin imss|sin seguro|dado de baja)/.test(low)) {
        answer = true; rule = "natural_imss_positive_bound_to_last_question";
      } else if (/(?:no tengo|no cuento con|sin)\s+(?:imss|seguro)|(?:estoy|me encuentro)\s+(?:dado de baja|sin alta)/.test(low)) {
        answer = false; rule = "natural_imss_negative_bound_to_last_question";
      }
    }
    if (answer !== null) {
      if (key === "tiene_imss") patch.tiene_imss = answer;
      if (key === "afiliado_imss_al_fallecer") patch.caso_fallecimiento = { afiliado_imss_al_fallecer: answer };
      if (key === "afore_contactada") patch.caso_fallecimiento = { afore_contactada: answer };
      resolved.push(key);
      events.push({ field: key, value: answer, rule });
    }
  }


  if (key === "curp") {
    const low = normalized(text);
    const curp = normalizeCurp(text);
    if (curp.valid) {
      patch.curp_recibida = true;
      patch.curp_valor = curp.value;
      patch.slots = { ...(patch.slots || {}), curp_disponible: true, curp_estado: "recibida" };
      resolved.push("curp");
      events.push({ field: "curp", value: curp.value, rule: curp.rule });
    } else if (/no la tengo|no tengo curp|no cuento con curp|no la traigo|no la tengo a la mano|estoy fuera de casa/.test(low)) {
      patch.slots = { ...(patch.slots || {}), curp_disponible: false, curp_estado: "no_disponible" };
      resolved.push("curp_disponibilidad");
      events.push({ field: "curp", value: "no_disponible", rule: "explicit_unavailable_slot" });
    }
  }

  if (key === "nss") {
    const low = normalized(text);
    if (/no tengo nss|no tengo numero|no cuento con nss/.test(low)) {
      patch.slots = { ...(patch.slots || {}), nss_disponible: false, nss_estado: "no_disponible" };
      resolved.push("nss_disponibilidad");
      if (/curp/.test(low)) { patch.slots.curp_disponible = true; patch.slots.curp_estado = "ofrecida"; }
    }
  }

  return { patch, resolved, events };
}
