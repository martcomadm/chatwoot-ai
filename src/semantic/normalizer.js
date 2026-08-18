function clean(value) {
  return String(value ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeEmployment(text) {
  const value = clean(text);
  if (!value) return null;

  if (/\b(desemplead[oa]|sin empleo|sin trabajo|no tengo trabajo|no tengo empleo|no trabajo|no estoy trabajando|actualmente no trabajo|actualmente no laboro|no laboro)\b/.test(value)) {
    return { value: "desempleado", rule: "employment_unemployed", confidence: 1 };
  }
  if (/\b(trabajo por mi cuenta|por mi cuenta|independiente|autoemplead[oa]|negocio propio|comerciante)\b/.test(value)) {
    return { value: "independiente", rule: "employment_independent", confidence: 1 };
  }
  if (/\b(tengo (?:un )?empleo|soy emplead[oa]|estoy trabajando|trabajo en|trabajo para|laboro en)\b/.test(value)) {
    return { value: "empleado", rule: "employment_employed", confidence: 0.98 };
  }
  return null;
}

export function normalizeImss(text) {
  const value = clean(text);
  if (!value) return null;
  if (/\b(no tengo|no cuento con|no estoy afiliad[oa]|ya no tengo|sin)\b.{0,28}\b(imss|seguro)\b/.test(value) || /^no+$/.test(value)) {
    return { value: false, rule: "imss_inactive", confidence: 1 };
  }
  if (/\b(si|sí|correcto|asi es|así es)\b/.test(String(text).trim().toLowerCase()) && String(text).trim().split(/\s+/).length <= 4) {
    return { value: true, rule: "short_yes", confidence: 0.85 };
  }
  if (/\b(si tengo|sí tengo|cuento con|estoy afiliad[oa]|tengo imss|tengo seguro)\b/.test(value)) {
    return { value: true, rule: "imss_active", confidence: 1 };
  }
  return null;
}

export function semanticEquivalent(field, a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (field === "tipo_trabajo" || field === "actividad") {
    const aa = typeof a === "string" ? normalizeEmployment(a)?.value || clean(a) : a;
    const bb = typeof b === "string" ? normalizeEmployment(b)?.value || clean(b) : b;
    return aa === bb;
  }
  if (field === "tiene_imss") return Boolean(a) === Boolean(b);
  return clean(a) === clean(b);
}

export function normalizeSemantic(text) {
  const employment = normalizeEmployment(text);
  const imss = normalizeImss(text);
  const items = [];
  if (employment) items.push({ field: "tipo_trabajo", ...employment, original: String(text ?? "") });
  if (imss) items.push({ field: "tiene_imss", ...imss, original: String(text ?? "") });
  return items;
}
