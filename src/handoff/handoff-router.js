function weekdayKey(date, timezone){
  const wd = new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:timezone}).format(date).toLowerCase();
  if(wd === "sat") return "saturday";
  if(wd === "sun") return "sunday";
  return "weekday";
}
function dateKey(date, timezone){
  const parts = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).formatToParts(date);
  const get = type => parts.find(p=>p.type===type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function normalizeName(value){
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
}

export class HandoffRouter {
  constructor({ config, store, chatwoot, operationsConfig = null }) {
    this.config = config;
    this.store = store;
    this.chatwoot = chatwoot;
    this.operationsConfig = operationsConfig;
  }

  groupFor(date = new Date()){ return weekdayKey(date, this.config.ai.timezone); }
  dateKey(date = new Date()){ return dateKey(date, this.config.ai.timezone); }

  agentsFor(group, date = new Date(), options = {}){
    if(this.operationsConfig){
      return this.operationsConfig.agentsFor(group, this.dateKey(date), options);
    }
    if(group === "saturday") return this.config.handoff.saturdayAgents;
    if(group === "sunday") return this.config.handoff.sundayAgents;
    return this.config.handoff.weekdayAgents;
  }

  findAgentByName(name, date = new Date()){
    const group = this.groupFor(date);
    const agents = this.agentsFor(group, date);
    const target = normalizeName(name);
    if(!target) return null;
    const exact = agents.find(agent=>normalizeName(agent.name)===target);
    if(exact) return {group,agent:exact};
    const first = target.split(" ")[0];
    const matches = agents.filter(agent=>normalizeName(agent.name).split(" ")[0]===first);
    return matches.length===1 ? {group,agent:matches[0]} : null;
  }

  async reserve({conversationId,date=new Date()}){
    if(!this.config.handoff.enabled) return {status:"skipped",reason:"auto_handoff_disabled",group:this.groupFor(date)};
    const group = this.groupFor(date);
    const agents = this.agentsFor(group,date);
    if(!agents.length) return {status:"skipped",reason:"no_agents_configured",group};
    return this.store.reserve({group,agents,conversationId});
  }

  async route({conversationId,reason,reservedAdvisor=null,date=new Date()}){
    if(!this.config.handoff.enabled) return {status:"skipped",reason:"auto_handoff_disabled",group:this.groupFor(date)};
    let reserved = reservedAdvisor;
    if(!reserved?.agent_id){
      reserved = await this.reserve({conversationId,date});
      if(reserved.status!=="reserved") return reserved;
      reserved = {
        agent_id:reserved.agent.id,agent_name:reserved.agent.name,group:reserved.group,
        rotation_position:reserved.rotation_position,total_agents:reserved.total_agents,reserved_at:reserved.reserved_at
      };
    }
    const group = reserved.group || this.groupFor(date);
    const configured = this.agentsFor(group,date,{activeOnly:false});
    const agent = configured.find(item=>Number(item.id)===Number(reserved.agent_id)) || {id:Number(reserved.agent_id),name:reserved.agent_name||`Agente ${reserved.agent_id}`};
    return this.store.assignReserved({
      group,agent,conversationId,reason,rotationPosition:reserved.rotation_position||null,totalAgents:reserved.total_agents||configured.length||null,
      assignFn:async target=>{
        const response = await this.chatwoot.assignConversation(conversationId,target.id);
        const responseId = Number(response?.id);
        if(Number.isFinite(responseId) && responseId!==Number(target.id)) throw new Error(`Chatwoot confirmó un usuario distinto al esperado: ${responseId}`);
        return response;
      }
    });
  }
}
