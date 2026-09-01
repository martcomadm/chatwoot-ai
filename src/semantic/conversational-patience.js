
function norm(v){return String(v??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}

export function analyzePatience(text,memory={}){
  const v=norm(text);
  const slot=(memory?.ultima_pregunta||memory?.flujo?.siguiente_paso||"").toLowerCase();
  const sensitive=["curp","nss"].includes(slot)?slot:(/\bcurp\b/.test(v)?"curp":/\bnss\b/.test(v)?"nss":null);
  let state=null,rule=null;

  if(/\b(ma[nñ]ana|despues|luego|mas tarde)\b.{0,45}\b(?:mando|mandar|envio|enviar|paso|pasar|comparto|compartir|doy|dar)\b|\b(?:te|se) (?:lo|la) (?:mando|envio|paso) ma[nñ]ana\b/.test(v)){
    state="promised_later";rule="promised_later";
  } else if(/\b(?:espera|esperame|permit[ea]me|me permites|dame (?:un )?momento|un momento|lo estoy buscando|la estoy buscando|estoy buscando|dejame buscar|deja buscar|ahorita (?:lo|la) busco)\b/.test(v)){
    state="searching";rule="customer_searching";
  } else if(/\b(?:no me se|no se|no tengo|no cuento con|no traigo|no tengo nada de|no la tengo|no lo tengo)\b.{0,25}\b(?:curp|nss)\b|\b(?:curp|nss)\b.{0,20}\b(?:no me la se|no me lo se|no la se|no lo se)\b/.test(v)){
    state="unavailable";rule="explicit_unavailable";
  } else if(/\b(?:no quiero|prefiero no|no deseo)\b.{0,30}\b(?:dar|compartir|enviar)\b/.test(v)){
    state="declined";rule="explicit_declined";
  }

  const pressure=/(?:ya te dije|ya le dije|ya te lo dije|no insistas?|por que insistes?|mala impresion|tu insistencia|est[aá]s insistiendo|no entiendes|no entiende)/.test(v);
  const waitRequest=state==="searching"||state==="promised_later";
  const patch={};
  const events=[];

  if(sensitive&&state){
    patch.slots={
      [`${sensitive}_estado`]:state,
      [`${sensitive}_disponible`]:state==="unavailable"?false:undefined
    };
    patch.blocked_questions=[sensitive];
    patch.data_collection={
      active_pause:waitRequest,
      paused_slot:sensitive,
      pause_reason:state,
      sensitive_requests_suppressed:true,
      last_state_at:new Date().toISOString()
    };
    events.push({type:"sensitive_slot_state",field:sensitive,state,rule});
  }
  if(pressure){
    patch.data_collection={
      ...(patch.data_collection||{}),
      sensitive_requests_suppressed:true,
      pressure_detected:true,
      active_pause:true,
      pause_reason:"pressure"
    };
    events.push({type:"sensitive_pressure_detected",evidence:v.slice(0,180)});
  }

  return {
    slot:sensitive,state,waitRequest,pressure,
    shouldPause:Boolean(waitRequest||pressure),
    reply:pressure
      ?"Tienes razón, no es necesario que te lo vuelva a pedir. Cuando lo tengas a la mano continuamos."
      :waitRequest
        ?"Claro, tómate tu tiempo. Cuando lo tengas a la mano me lo envías y continuamos."
        :state==="unavailable"
          ?"No hay problema, dejamos ese dato pendiente por ahora y continuamos con la orientación."
          :null,
    patch,events
  };
}

export function sensitiveSlotSuppressed(memory,key){
  if(!["curp","nss"].includes(key))return false;
  const state=memory?.slots?.[`${key}_estado`];
  return Boolean(
    memory?.data_collection?.sensitive_requests_suppressed ||
    ["promised_later","searching","unavailable","declined","ask_later","refused"].includes(state)
  );
}
