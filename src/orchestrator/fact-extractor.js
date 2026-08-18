import { extractAge } from '../semantic/age-extractor.js';
import { normalizeCurp } from '../semantic/curp-normalizer.js';

export function extractConversationFacts(text,memory={}){
  const raw=String(text??'');
  const patch={pension_data:{}};
  const events=[];
  const age=extractAge(raw,memory);
  if(age){patch.edad=age.value;events.push({field:'edad',value:age.value,rule:age.rule});}
  const weeks=raw.match(/\b(\d{2,4})\s+semanas?(?:\s+cotizadas?)?/i)?.[1];
  if(weeks){patch.pension_data.semanas=Number(weeks);patch.intereses={...(patch.intereses||{}),semanas_cotizadas:true};events.push({field:'semanas',value:Number(weeks),rule:'explicit_weeks'});}
  const law=raw.match(/\bley\s*(73|97)\b/i)?.[1];
  if(law){patch.pension_data.ley=`ley_${law}`;events.push({field:'ley',value:`ley_${law}`,rule:'explicit_pension_law'});}
  const years=raw.match(/\b(?:hace|llevo|tengo)\s+(\d{1,2})\s+a(?:ñ|n)os?\s+(?:sin\s+)?cotizar/i)?.[1]
    || raw.match(/\b(\d{1,2})\s+a(?:ñ|n)os?\s+sin\s+cotizar/i)?.[1];
  if(years){patch.ultima_cotizacion=`hace ${Number(years)} años`;patch.pension_data.anos_sin_cotizar=Number(years);events.push({field:'anos_sin_cotizar',value:Number(years),rule:'explicit_years_without_contributions'});}
  const curp=normalizeCurp(raw);
  if(curp.valid){patch.curp_recibida=true;patch.curp_valor=curp.value;patch.slots={curp_disponible:true,curp_estado:'recibida'};events.push({field:'curp',value:curp.value,rule:curp.rule});}
  return {patch,events};
}
