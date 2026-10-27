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
  // Casos reales 23 al 26-oct: "Cuando cuesta", "onararios", "Gravias igualmente", "No grscias",
  // "x cuánto tiempo tendría q cotizar", "pencion".
  [/\bcuando (cuesta|cobran|sale|vale|seria el costo)\b/gi, "cuanto $1"],
  [/\b(?:h?onorarios|onorarios|onararios|honararios)\b/gi, "honorarios"],
  [/\b(?:gravias|grscias|grasias|graciaz|grax|gracia)\b/gi, "gracias"],
  [/\bx\b(?=\s+(?:cu[aá]nto|favor|fa|el|la|mes|semana|tiempo|que))/gi, "por"],
  [/\bq\b(?=\s+(?:cotizar|tener|pagar|hacer|aser|debo|tengo|necesito|es|implica|incluye|cuesta|onda))/gi, "que"],
  [/\bpen[cs]i[oó][nm]\b/gi, "pensión"],
  [/\bpen[cs]ionarme\b/gi, "pensionarme"],
  [/\b(?:i fonavit|imfonavit|infonavid|infonabit|imfonabit)\b/gi, "infonavit"],
  // "Solo servicuo", "Solo segurk medici" (caso real 27-oct).
  [/\bservicuo\b/gi, "servicio"],
  [/\bsegur[ko]\s+medic[io]\b/gi, "seguro medico"],
];

export function fixCommonTypos(text = "") {
  let value = String(text || "");
  for (const [re, to] of FIXES) value = value.replace(re, to);
  return value;
}
