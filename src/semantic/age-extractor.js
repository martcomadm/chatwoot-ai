function clean(value){return String(value??'').trim();}

export function extractAge(text, memory={}){
  const raw=clean(text);
  const explicit=raw.match(/\b(?:tengo|tiene|cumpl[ií]|cumpli[oó]|cumpl[ií]a|edad(?:\s+de)?)[^\d]{0,12}(1[89]|[2-9]\d)\s*a(?:ñ|n)os?\b/i)?.[1]
    || raw.match(/\b(1[89]|[2-9]\d)\s*a(?:ñ|n)os?\b/i)?.[1];
  if(explicit) return {value:Number(explicit),rule:'explicit_age'};

  if(memory?.ultima_pregunta==='edad'){
    const only=raw.match(/^\s*(1[89]|[2-9]\d)\s*$/)?.[1];
    if(only) return {value:Number(only),rule:'answer_to_age_question'};
  }

  return null;
}
