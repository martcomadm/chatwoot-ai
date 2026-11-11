// El cliente descarta solo una parte de la oferta ("No me interesa Infonavit", "sin afore",
// "no me interesa el plan 2"): no es una despedida. Se le ofrece el Plan 1, que cubre servicio
// médico y semanas, en vez de "gracias por tu tiempo" (caso real 19-oct: se perdió la venta).

function norm(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const FEATURE = "(?:para |por |en )?(?:el |la |lo de |lo del |los )?(?:infonavit|afore|credito|credito infonavit|puntos|vivienda|casa|plan (?:2|dos))";
const REJECTS_FEATURE_RE = new RegExp(`^(?:(?:no|pues|pero|y|ok|bueno|gracias)\\s+)*(?:no\\s+)?(?:me interesa|quiero|necesito|ocupo|busco|me sirve)\\s+${FEATURE}\\b|^(?:(?:pero|y)\\s+)?(?:sin|menos|excepto|nada de)\\s+${FEATURE}\\b|^(?:(?:el|la)\\s+)?(?:infonavit|afore|plan (?:2|dos))\\s+no\\b|\\b(?:lo unico|la unica cosa|solo)\\s+(?:que|q|k)\\s+no\\s+(?:quiero|me interesa|necesito|ocupo)\\s+(?:es\\s+)?${FEATURE}\\b`);

// Algún renglón pide AFORE sin negarlo ("aportaciones al Afore").
export function wantsAfore(text = "") {
  return String(text || "").split(/\n+|,|;|\by\b/).some(part => {
    const v = norm(part);
    return /\bafore\b/.test(v) && !/\b(?:no|sin|menos|excepto|nada de)\b/.test(v);
  });
}

export function rejectsFeature(text = "") {
  // "Si xfa / Lo único q no quiero es lo del Infonavit" (caso real 20-oct): se revisa cada renglón.
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) { const kind = rejectsFeatureLine(line); if (kind) return kind; }
    return null;
  }
  return rejectsFeatureLine(text);
}

function rejectsFeatureLine(text = "") {
  const raw = String(text || "");
  if (/[?¿]/.test(raw)) return null;
  const value = norm(raw);
  if (!value || value.split(" ").length > 12) return null;
  if (!/\b(?:no|sin|menos|excepto|nada de)\b/.test(value)) return null;
  if (!REJECTS_FEATURE_RE.test(value)) return null;
  // "No me interesa" a secas o "no me interesa nada" sí es una despedida: lo maneja customer-deferral.
  if (/\b(?:nada|ninguno|ninguna)\b/.test(value)) return null;
  if (/\bafore\b/.test(value) && !/\binfonavit\b/.test(value)) return "afore";
  if (/\bplan (?:2|dos)\b/.test(value)) return "plan_2";
  return "infonavit";
}

export function featureRejectionDecision(memory = {}, combinedText = "") {
  if (memory.sales_cycle?.authorized) return null;
  const kind = rejectsFeature(combinedText);
  if (!kind) return null;
  // "Servicio de IMSS / acumular semanas / aportaciones al Afore / Infonavit no" (caso real 5-nov): quiere AFORE,
  // así que es el Plan 2 (incluye AFORE e INFONAVIT; no hay un plan solo con AFORE). Antes se le ofrecía el Plan 1.
  if (kind === "infonavit" && wantsAfore(combinedText)) {
    return { reply: "Entendido. Como sí te interesa que se aporte a tu AFORE, el plan que te conviene es el Plan 2, de $1,500 MXN mensuales: incluye servicio médico del IMSS, semanas cotizadas y aportaciones a tu AFORE. Los puntos INFONAVIT vienen incluidos en el mismo plan aunque no los uses; no manejamos un plan solo con AFORE. ¿Quieres que te explique cómo funciona?", question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", rejected_feature: kind, plan: "plan_2" };
  }
  const reply = kind === "infonavit"
    ? "Entendido, no hay problema. Si lo que buscas es servicio médico y seguir sumando semanas, el Plan 1 de $1,100 MXN mensuales es suficiente: incluye servicio médico del IMSS y semanas cotizadas. El Plan 2 solo conviene si además quieres aportar a tu AFORE. ¿Quieres que iniciemos tu trámite con el Plan 1?"
    : "Entendido, no hay problema. Entonces el Plan 1 de $1,100 MXN mensuales es el indicado: incluye servicio médico del IMSS y semanas cotizadas, sin AFORE ni INFONAVIT. ¿Quieres que iniciemos tu trámite con el Plan 1?";
  return { reply, question_key: null, add_labels: [], remove_labels: [], handoff: false, handoff_reason: "", rejected_feature: kind, plan: "plan_1" };
}
