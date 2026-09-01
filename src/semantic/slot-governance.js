function norm(v){return String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}

export function governSlotAnswer(text,memory={}){
  const key=memory?.ultima_pregunta||memory?.flujo?.siguiente_paso||null;
  if(!['curp','nss'].includes(key)) return {patch:{},events:[]};
  const v=norm(text);
  const slot=key;
  let state=null;
  if(/no (?:la|lo) tengo a la mano|ahora no (?:la|lo) tengo|en cuanto pueda|estoy fuera de casa|estoy en el hospital|despues te (?:la|lo) mando|luego te (?:la|lo) paso/.test(v)) state='ask_later';
  else if(/no tengo (?:curp|nss)|no cuento con (?:curp|nss)|no (?:la|lo) tengo/.test(v)) state='unavailable';
  else if(/no (?:quiero|deseo) compartir|prefiero no (?:dar|compartir)|no voy a (?:dar|compartir)/.test(v)) state='refused';
  if(!state) return {patch:{},events:[]};
  return {
    patch:{slots:{[`${slot}_estado`]:state,[`${slot}_disponible`]:state==='unavailable'?false:undefined},blocked_questions:[slot]},
    events:[{type:'slot_governed',field:slot,state,rule:`explicit_${state}`}]
  };
}

export function slotBlocked(memory,key){
  if((memory?.blocked_questions||[]).includes(key)) return true;
  const state=memory?.slots?.[`${key}_estado`];
  return ['unavailable','refused','ask_later','promised_later','searching','declined'].includes(state);
}
