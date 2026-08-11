function norm(v){return String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
const RELATIONS=[
  ['padre',/\b(mi|para mi) (papa|padre)\b/],['madre',/\b(mi|para mi) (mama|madre)\b/],
  ['esposa',/\b(mi|para mi) esposa\b/],['esposo',/\b(mi|para mi) esposo\b/],
  ['hija',/\b(mi|para mi) hija\b/],['hijo',/\b(mi|para mi) hijo\b/],
  ['hermana',/\b(mi|para mi) hermana\b/],['hermano',/\b(mi|para mi) hermano\b/]
];
export function resolveSubject(text,memory={}){
  const value=norm(text);
  for(const [relation,re] of RELATIONS){
    if(re.test(value)) return {patch:{caso_sujeto:{tipo:'tercero',relacion:relation}},events:[{relation,rule:'explicit_relation'}]};
  }
  return {patch:{},events:[]};
}
