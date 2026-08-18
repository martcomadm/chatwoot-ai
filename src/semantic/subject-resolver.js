function norm(v){return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
const RELATIONS=[
  {relation:'padre',aliases:['padre','papa']},
  {relation:'madre',aliases:['madre','mama']},
  {relation:'esposa',aliases:['esposa']},
  {relation:'esposo',aliases:['esposo']},
  {relation:'hija',aliases:['hija']},
  {relation:'hijo',aliases:['hijo']},
  {relation:'hermana',aliases:['hermana']},
  {relation:'hermano',aliases:['hermano']},
];

export function resolveSubject(text,memory={}){
  const value=norm(text);
  for(const item of RELATIONS){
    if(item.aliases.includes(value)){
      return {patch:{caso_sujeto:{tipo:'tercero',relacion:item.relation,confidence:'high',source:'standalone_relation_correction'}},events:[{relation:item.relation,rule:'standalone_relation_correction'}]};
    }
  }
  for(const item of RELATIONS){
    for(const alias of item.aliases){
      const positive=new RegExp(`\\b(?:es|seria|necesito|quiero|tramite|caso).{0,30}(?:para )?mi ${alias}\\b|\\bpara mi ${alias}\\b`,'i');
      const negated=new RegExp(`\\bno.{0,20}(?:para )?mi ${alias}\\b`,'i');
      if(positive.test(value) && !negated.test(value)){
        return {patch:{caso_sujeto:{tipo:'tercero',relacion:item.relation,confidence:'high',source:'explicit_relation'}},events:[{relation:item.relation,rule:'explicit_relation'}]};
      }
    }
  }
  if(/\b(es para mi|lo necesito para mi|para mi mismo|para mi misma)\b/.test(value)){
    return {patch:{caso_sujeto:{tipo:'self',relacion:null,confidence:'high',source:'explicit_self'}},events:[{relation:'self',rule:'explicit_self'}]};
  }
  return {patch:{},events:[]};
}
