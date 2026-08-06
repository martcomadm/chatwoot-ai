import fs from "node:fs";
import path from "node:path";

const EMPTY = {
  nombre:null,primer_nombre:null,edad:null,actividad:null,tipo_trabajo:null,tiene_imss:null,
  ultima_cotizacion:null,necesidad_principal:null,necesidades:[],intereses:{},
  contexto_laboral:{},afore_actual:null,pregunta_cambio_afore:false,
  curp_recibida:false,nss_recibido:false,documentos_recibidos:[],contradicciones:[],
  ventas:{plan_recomendado:null,temperatura:"frio",problema:null},
  flujo:{fase:"inicio",siguiente_paso:null},
  asesor_presentacion:null,presentacion_realizada:false,
  preguntas_realizadas:[],ultima_pregunta:null,ultima_respuesta_agente:null,
  mensajes_procesados:[],actualizado_en:null
};

function deepMerge(base,patch){
  const out={...base,...patch};
  for(const key of ["intereses","contexto_laboral","ventas","flujo"]){out[key]={...(base[key]||{}),...(patch[key]||{})};}
  return out;
}

export class MemoryStore {
  constructor(filePath){this.filePath=filePath;this.data={};this.queue=Promise.resolve();this.load();}
  load(){
    try{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      if(fs.existsSync(this.filePath)){
        const raw=fs.readFileSync(this.filePath,"utf8").trim();
        this.data=raw?JSON.parse(raw):{};
      }else this.persistSync();
    }catch(error){console.error("Error cargando memoria:",error);this.data={};}
  }
  persistSync(){const tmp=this.filePath+".tmp";fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),"utf8");fs.renameSync(tmp,this.filePath);}
  async persist(){
    this.queue=this.queue.then(async()=>{
      await fs.promises.mkdir(path.dirname(this.filePath),{recursive:true});
      const tmp=this.filePath+".tmp";
      await fs.promises.writeFile(tmp,JSON.stringify(this.data,null,2),"utf8");
      await fs.promises.rename(tmp,this.filePath);
    });
    return this.queue;
  }
  get(id){return deepMerge(structuredClone(EMPTY),this.data[String(id)]||{});}
  async set(id,memory){this.data[String(id)]={...deepMerge(structuredClone(EMPTY),memory),actualizado_en:new Date().toISOString()};await this.persist();return this.get(id);}
  async merge(id,patch){return this.set(id,deepMerge(this.get(id),patch));}
  hasProcessed(id,messageId){return this.get(id).mensajes_procesados.includes(String(messageId));}
  async markProcessedMany(id,messageIds){
    const memory=this.get(id);
    const ids=[...new Set([...memory.mensajes_procesados,...messageIds.map(String)])].slice(-300);
    return this.merge(id,{mensajes_procesados:ids});
  }
  async clear(id){delete this.data[String(id)];await this.persist();}

  list(){
    return Object.entries(this.data)
      .map(([id,memory])=>({id:Number(id),...this.get(id),raw_actualizado_en:memory?.actualizado_en||null}))
      .filter(item=>Number.isFinite(item.id))
      .sort((a,b)=>String(b.actualizado_en||'').localeCompare(String(a.actualizado_en||'')));
  }
}
