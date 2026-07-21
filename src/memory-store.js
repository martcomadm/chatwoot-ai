import fs from "node:fs";
import path from "node:path";

const EMPTY = {
  nombre:null, edad:null, actividad:null, tipo_trabajo:null, tiene_imss:null,
  ultima_cotizacion:null, necesidad_principal:null, necesidades:[],
  afore_actual:null, pregunta_cambio_afore:false, curp_recibida:false,
  nss_recibido:false, documentos_recibidos:[], contradicciones:[],
  preguntas_realizadas:[], ultima_pregunta:null, ultima_respuesta_agente:null,
  mensajes_procesados:[], actualizado_en:null
};

export class MemoryStore {
  constructor(filePath){
    this.filePath=filePath; this.data={}; this.queue=Promise.resolve(); this.load();
  }
  load(){
    try{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      if(fs.existsSync(this.filePath)){
        const raw=fs.readFileSync(this.filePath,"utf8").trim();
        this.data=raw?JSON.parse(raw):{};
      } else this.persistSync();
    }catch(e){console.error("Error cargando memoria:",e); this.data={};}
  }
  persistSync(){
    const tmp=this.filePath+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),"utf8");
    fs.renameSync(tmp,this.filePath);
  }
  async persist(){
    this.queue=this.queue.then(async()=>{
      await fs.promises.mkdir(path.dirname(this.filePath),{recursive:true});
      const tmp=this.filePath+".tmp";
      await fs.promises.writeFile(tmp,JSON.stringify(this.data,null,2),"utf8");
      await fs.promises.rename(tmp,this.filePath);
    });
    return this.queue;
  }
  get(id){return {...structuredClone(EMPTY),...(this.data[String(id)]||{})};}
  async set(id,memory){
    this.data[String(id)]={...structuredClone(EMPTY),...memory,actualizado_en:new Date().toISOString()};
    await this.persist(); return this.get(id);
  }
  async merge(id,patch){return this.set(id,{...this.get(id),...patch});}
  hasProcessed(id,messageId){return this.get(id).mensajes_procesados.includes(String(messageId));}
  async markProcessed(id,messageId){
    const m=this.get(id);
    const ids=[...new Set([...m.mensajes_procesados,String(messageId)])].slice(-200);
    return this.merge(id,{mensajes_procesados:ids});
  }
  async clear(id){delete this.data[String(id)]; await this.persist();}
}
