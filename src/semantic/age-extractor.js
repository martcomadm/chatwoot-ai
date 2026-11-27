function clean(value){return String(value??'').trim();}

export function extractAge(text, memory={}){
  const raw=clean(text);
  const explicit=raw.match(/\b(?:tengo|tiene|cumpl[ií]|cumpli[oó]|cumpl[ií]a|edad(?:\s+de)?)[^\d]{0,12}(1[89]|[2-9]\d)\s*a(?:ñ|n)os?\b/i)?.[1]
    || raw.match(/\b(1[89]|[2-9]\d)\s*a(?:ñ|n)os?\b/i)?.[1];
  if(explicit) return {value:Number(explicit),rule:'explicit_age'};

  const askedAge=memory?.ultima_pregunta==='edad'||/\b(cu[aá]ntos a[nñ]os|tu edad|qu[eé] edad)\b/i.test(String(memory?.ultima_respuesta_agente||''));
  if(askedAge){
    const only=raw.match(/^\s*(1[89]|[2-9]\d)\s*$/)?.[1];
    if(only) return {value:Number(only),rule:'answer_to_age_question'};
    // "ACTUALMENTE 58", "Ya 60", "56 ya próximamente 57" (casos reales): el primer número de una respuesta corta.
    const short=raw.length<=40&&!/\b(semanas?|pesos|\$|mil|años cotiz)/i.test(raw)?raw.match(/(?:^|[^\d])(1[89]|[2-9]\d)(?!\d)/)?.[1]:null;
    if(short) return {value:Number(short),rule:'short_answer_to_age_question'};
  }

  return null;
}
