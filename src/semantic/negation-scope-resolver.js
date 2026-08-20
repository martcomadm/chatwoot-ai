function norm(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/\s+/g," ")
    .trim();
}

export function resolveNegationScope(text){
  const v=norm(text);
  if(!v) return {status:"neutral",confidence:0,reason:"empty"};

  // Explicit punctuation/affirmation after "No": definitely positive.
  if(/^no\s*,\s*(?:si\s+)?(?:quiero|me interesa|deseo)\b/.test(v) ||
     /^no\s+si\s+(?:quiero|me interesa|deseo)\b/.test(v)){
    return {status:"positive",confidence:.97,reason:"explicit_positive_after_no"};
  }

  // Exact real-world ambiguity: likely missing comma after "No".
  if(/^no\s+quiero\s+informacion\b/.test(v) && /\bpor\s+favor\b/.test(v)){
    return {
      status:"ambiguous",
      confidence:.35,
      reason:"possible_missing_comma_after_no",
      clarification:"Solo para confirmar, ¿sí deseas que te brindemos información?"
    };
  }

  // Clear negatives must be resolved before generic "quiero..." positives.
  if(/\bya\s+no\s+me\s+interesa\b/.test(v) ||
     /\bno\s+me\s+interesa\b/.test(v) ||
     /\bno\s+(?:quiero|deseo)\s+(?:informacion|el servicio|seguir|continuar|afiliarme|cotizar)\b/.test(v) ||
     /\bno\s+quiero\s+nada\b/.test(v)){
    return {status:"negative",confidence:.95,reason:"clear_negative"};
  }

  // Other leading "No" + request language is ambiguous.
  const requestCue=/\bpor\s+favor\b|\bquiero\s+(?:informacion|saber|cotizar|continuar|seguir)\b|\bnecesito\b|\bme\s+gustaria\b/.test(v);
  if(/^no\b/.test(v) && requestCue){
    return {
      status:"ambiguous",
      confidence:.45,
      reason:"leading_no_with_request_language",
      clarification:"Solo para confirmar, ¿sí deseas que te brindemos información?"
    };
  }

  // Normal positive requests.
  if(/\bsi\s+(?:quiero|me interesa|deseo)\b/.test(v) ||
     /\bquiero\s+(?:informacion|saber|cotizar|continuar|seguir)\b/.test(v) ||
     /\bnecesito\s+(?:informacion|saber|cotizar|ayuda)\b/.test(v)){
    return {status:"positive",confidence:.95,reason:"clear_positive"};
  }

  return {status:"neutral",confidence:.5,reason:"no_decision"};
}
