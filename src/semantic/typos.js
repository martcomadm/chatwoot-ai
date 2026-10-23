// Faltas de ortografía frecuentes de los clientes que impedían reconocer la pregunta
// (casos reales 21-oct: "cuales son los rekisitos", "cómo funsiona", "k nesesitamos",
// "Solopara servisiomedico"). Solo palabras completas y sin ambigüedad.
const FIXES = [
  [/\b(?:rekisitos?|requicitos?|recuisitos?|requisistos?|resquisitos?|requesitos?|requicito)\b/gi, "requisitos"],
  [/\bfun[sz]iona\b/gi, "funciona"],
  [/\bfun[sz]ionan\b/gi, "funcionan"],
  [/\bne[sc]e[sc]it(o|as|a|amos|an)\b/gi, "necesit$1"],
  [/\bservi[sz]io(s)?\b/gi, "servicio$1"],
  [/\bservisiomedico\b/gi, "servicio medico"],
  [/\bsolopara\b/gi, "solo para"],
  [/\bmensualida\b/gi, "mensualidad"],
  [/\blamensualida[d]?\b/gi, "la mensualidad"],
  [/\b(?:kuanto|quanto)\b/gi, "cuanto"],
  [/\bdevaja\b/gi, "de baja"],
  [/\bk\b(?=\s+(?:necesit|nesesit|ocup|incluye|cuesta|es|hay|tengo|debo|documentos))/gi, "que"],
  [/\bxq\b|\bporke\b|\bporq\b/gi, "porque"],
];

export function fixCommonTypos(text = "") {
  let value = String(text || "");
  for (const [re, to] of FIXES) value = value.replace(re, to);
  return value;
}
