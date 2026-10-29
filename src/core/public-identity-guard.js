function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripRepeatedPublicPresentation(reply, publicName = "Mia de MARTCOM") {
  let text = String(reply || "").trim();
  if (!text) return text;

  const name = escapeRegExp(publicName);
  const patterns = [
    new RegExp(`^(?:hola[,!.]?\\s*)?soy\\s+${name}[,!.:\\-]?\\s*`, "i"),
    new RegExp(`^(?:hola[,!.]?\\s*)?(?:mi nombre es|te atiende)\\s+${name}[,!.:\\-]?\\s*`, "i"),
  ];

  for (const pattern of patterns) text = text.replace(pattern, "").trim();
  if (!text) return "Claro, continuemos con tu caso.";
  return text.charAt(0).toUpperCase() + text.slice(1);
}
