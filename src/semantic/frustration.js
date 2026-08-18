export function detectFrustration(text) {
  const raw = String(text ?? "").toLowerCase();
  let score = 0;
  const evidence = [];
  const add = (pattern, value, label) => { if (pattern.test(raw)) { score += value; evidence.push(label); } };
  add(/ya (?:te|le)? ?(?:lo )?(?:dije|hab[ií]a dicho|contest[eé]|indiqu[eé])/, 1, "ya_lo_dije");
  add(/ya la (?:puse|dije|indiqu[eé])/, 1, "dato_repetido");
  add(/cu[aá]ntas? m[aá]s|otra vez|de nuevo/, 1, "repeticion_reclamada");
  add(/\?\?\?+/, 1, "impaciencia");
  add(/no me (?:entiendes|est[aá]s entendiendo)|no entiende/, 2, "no_entendido");
  add(/mierda de servicio|p[eé]simo servicio|mal servicio/, 3, "frustracion_alta");
  return { score, evidence, detected: score > 0, high: score >= 2 };
}
