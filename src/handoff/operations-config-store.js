import fs from "node:fs";
import path from "node:path";

function clone(v){ return structuredClone(v); }
function nowIso(){ return new Date().toISOString(); }
function normalizeAgent(agent){
  const id = Number(agent?.id);
  if(!Number.isFinite(id) || id <= 0) return null;
  return { id, name: String(agent?.name || `Agente ${id}`).trim(), enabled: agent?.enabled !== false };
}
function normalizeAgents(items){
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map(normalizeAgent)
    .filter(Boolean)
    .filter(agent => {
      if(seen.has(agent.id)) return false;
      seen.add(agent.id);
      return true;
    });
}

export class OperationsConfigStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = {
      weekday: normalizeAgents(defaults.weekday || []),
      saturday: normalizeAgents(defaults.saturday || []),
      sunday: normalizeAgents(defaults.sunday || []),
    };
    this.state = { version:1, updated_at:null, groups:clone(this.defaults), exceptions:{}, audit:[], agents:[] };
    this.queue = Promise.resolve();
    this.load();
  }

  load(){
    try{
      fs.mkdirSync(path.dirname(this.filePath), {recursive:true});
      if(fs.existsSync(this.filePath)){
        const raw = fs.readFileSync(this.filePath, "utf8").trim();
        if(raw) this.state = JSON.parse(raw);
      }
      if(!this.state || typeof this.state !== "object") this.state = {};
      this.state.version = 1;
      this.state.groups = this.state.groups || {};
      for(const group of ["weekday","saturday","sunday"]){
        const current = normalizeAgents(this.state.groups[group]);
        this.state.groups[group] = current.length ? current : clone(this.defaults[group]);
      }
      this.state.exceptions = this.state.exceptions && typeof this.state.exceptions === "object" ? this.state.exceptions : {};
      const catalog = [];
      for(const group of ["weekday","saturday","sunday"]){
        for(const agent of this.state.groups[group] || []){
          if(!catalog.some(item=>item.id===agent.id)) catalog.push({id:agent.id,name:agent.name});
        }
      }
      for(const agent of this.state.agents || []){
        const normalized = normalizeAgent(agent);
        if(normalized && !catalog.some(item=>item.id===normalized.id)) catalog.push({id:normalized.id,name:normalized.name});
      }
      this.state.agents = catalog.sort((a,b)=>a.name.localeCompare(b.name,"es"));
      for(const [date, agents] of Object.entries(this.state.exceptions)){
        this.state.exceptions[date] = normalizeAgents(agents);
      }
      this.state.audit = Array.isArray(this.state.audit) ? this.state.audit.slice(-500) : [];
      this.persistSync();
    }catch(error){
      console.error("Operations Control: no se pudo cargar configuración:", error);
      this.state = { version:1, updated_at:null, groups:clone(this.defaults), exceptions:{}, audit:[], agents:[] };
      this.persistSync();
    }
  }

  persistSync(){
    fs.mkdirSync(path.dirname(this.filePath), {recursive:true});
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  async persist(){
    const task = this.queue.catch(()=>{}).then(async()=>{
      await fs.promises.mkdir(path.dirname(this.filePath), {recursive:true});
      const tmp = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
      await fs.promises.rename(tmp, this.filePath);
    });
    this.queue = task.catch(()=>{});
    return task;
  }

  snapshot(){ return clone(this.state); }

  agentsFor(group, dateKey = null, { activeOnly = true } = {}){
    let items;
    if(dateKey && Array.isArray(this.state.exceptions?.[dateKey])){
      items = this.state.exceptions[dateKey];
    }else{
      items = this.state.groups?.[group] || [];
    }
    const result = normalizeAgents(items);
    return clone(activeOnly ? result.filter(a=>a.enabled !== false) : result);
  }

  async setGroup(group, agents, actor="inspector-admin"){
    if(!["weekday","saturday","sunday"].includes(group)) throw new Error("Grupo inválido");
    const next = normalizeAgents(agents);
    if(!next.length) throw new Error("La rotación debe contener al menos un asesor");
    const before = clone(this.state.groups[group] || []);
    this.state.groups[group] = next;
    this.state.updated_at = nowIso();
    this.audit("rotation_changed", actor, {group,before,after:next});
    await this.persist();
    return this.snapshot();
  }

  async setException(dateKey, agents, actor="inspector-admin"){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey||""))) throw new Error("Fecha inválida");
    const next = normalizeAgents(agents);
    if(!next.length) throw new Error("La excepción debe contener al menos un asesor");
    const before = clone(this.state.exceptions?.[dateKey] || null);
    this.state.exceptions[dateKey] = next;
    this.state.updated_at = nowIso();
    this.audit("date_exception_changed", actor, {date:dateKey,before,after:next});
    await this.persist();
    return this.snapshot();
  }

  async deleteException(dateKey, actor="inspector-admin"){
    const before = clone(this.state.exceptions?.[dateKey] || null);
    delete this.state.exceptions[dateKey];
    this.state.updated_at = nowIso();
    this.audit("date_exception_deleted", actor, {date:dateKey,before});
    await this.persist();
    return this.snapshot();
  }


  async addMasterAgent(agent, actor="inspector-admin"){
    const normalized = normalizeAgent(agent);
    if(!normalized) throw new Error("Asesor inválido");
    this.state.agents = Array.isArray(this.state.agents) ? this.state.agents : [];
    const idx = this.state.agents.findIndex(item=>Number(item.id)===normalized.id);
    if(idx>=0) this.state.agents[idx] = {id:normalized.id,name:normalized.name};
    else this.state.agents.push({id:normalized.id,name:normalized.name});
    for(const group of ["weekday","saturday","sunday"]){
      this.state.groups[group] = normalizeAgents((this.state.groups[group]||[]).map(item =>
        Number(item.id)===normalized.id ? {...item,name:normalized.name} : item
      ));
    }
    this.syncCatalog();
    this.state.updated_at = nowIso();
    this.audit("master_agent_added", actor, {agent:normalized});
    await this.persist();
    return this.snapshot();
  }

  allAgents(){
    const catalog = [];
    const add = agent => {
      const normalized = normalizeAgent(agent);
      if(!normalized) return;
      const existing = catalog.find(item=>item.id===normalized.id);
      if(existing){ if(!existing.name && normalized.name) existing.name=normalized.name; return; }
      catalog.push({id:normalized.id,name:normalized.name});
    };
    for(const agent of this.state.agents || []) add(agent);
    for(const group of ["weekday","saturday","sunday"]){
      for(const agent of this.state.groups?.[group] || []) add(agent);
    }
    for(const agents of Object.values(this.state.exceptions || {})){
      for(const agent of agents || []) add(agent);
    }
    return clone(catalog.sort((a,b)=>a.name.localeCompare(b.name,"es")));
  }

  syncCatalog(){
    this.state.agents = this.allAgents();
  }

  async addAgentToGroup(group, agent, actor="inspector-admin"){
    if(!["weekday","saturday","sunday"].includes(group)) throw new Error("Grupo inválido");
    const normalized = normalizeAgent(agent);
    if(!normalized) throw new Error("Asesor inválido");
    const current = normalizeAgents(this.state.groups[group] || []);
    if(current.some(item=>item.id===normalized.id)) return this.snapshot();
    current.push(normalized);
    this.state.groups[group] = current;
    this.syncCatalog();
    this.state.updated_at = nowIso();
    this.audit("agent_copied_to_group", actor, {group,agent:normalized});
    await this.persist();
    return this.snapshot();
  }

  async removeAgentFromGroup(group, agentId, actor="inspector-admin"){
    if(!["weekday","saturday","sunday"].includes(group)) throw new Error("Grupo inválido");
    const id = Number(agentId);
    const before = normalizeAgents(this.state.groups[group] || []);
    const after = before.filter(item=>item.id!==id);
    if(!after.length) throw new Error("No puedes dejar una rotación sin asesores");
    this.state.groups[group] = after;
    this.syncCatalog();
    this.state.updated_at = nowIso();
    this.audit("agent_removed_from_group", actor, {group,agent_id:id});
    await this.persist();
    return this.snapshot();
  }

  async moveAgent({sourceGroup,targetGroup,agentId}, actor="inspector-admin"){
    if(sourceGroup===targetGroup) return this.snapshot();
    if(!["weekday","saturday","sunday"].includes(sourceGroup) || !["weekday","saturday","sunday"].includes(targetGroup)) throw new Error("Grupo inválido");
    const id = Number(agentId);
    const source = normalizeAgents(this.state.groups[sourceGroup] || []);
    const agent = source.find(item=>item.id===id) || this.allAgents().find(item=>item.id===id);
    if(!agent) throw new Error("Asesor no encontrado");
    const nextSource = source.filter(item=>item.id!==id);
    if(!nextSource.length) throw new Error("No puedes dejar una rotación sin asesores");
    const target = normalizeAgents(this.state.groups[targetGroup] || []);
    if(!target.some(item=>item.id===id)) target.push({...agent,enabled:true});
    this.state.groups[sourceGroup] = nextSource;
    this.state.groups[targetGroup] = target;
    this.syncCatalog();
    this.state.updated_at = nowIso();
    this.audit("agent_moved_between_groups", actor, {sourceGroup,targetGroup,agent});
    await this.persist();
    return this.snapshot();
  }

  async copyAgent({targetGroup,agentId}, actor="inspector-admin"){
    if(!["weekday","saturday","sunday"].includes(targetGroup)) throw new Error("Grupo inválido");
    const id = Number(agentId);
    const agent = this.allAgents().find(item=>item.id===id);
    if(!agent) throw new Error("Asesor no encontrado");
    const target = normalizeAgents(this.state.groups[targetGroup] || []);
    if(target.some(item=>item.id===id)) return this.snapshot();
    target.push({...agent,enabled:true});
    this.state.groups[targetGroup] = target;
    this.syncCatalog();
    this.state.updated_at = nowIso();
    this.audit("agent_copied_to_group", actor, {targetGroup,agent});
    await this.persist();
    return this.snapshot();
  }

  audit(type, actor, details){
    this.state.audit = Array.isArray(this.state.audit) ? this.state.audit : [];
    this.state.audit.push({id:`${Date.now()}-${Math.random().toString(16).slice(2)}`,timestamp:nowIso(),type,actor,details});
    this.state.audit = this.state.audit.slice(-500);
  }
}
