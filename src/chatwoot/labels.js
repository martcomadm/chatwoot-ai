const allowed = new Set(["asignado","cerrado","chat_basura","cliente","embarazo","no_contesta","no_quiere_el_servicio","predictivo","proveedor","reasignado","rechazado","seguimiento","sin_atender","validacion","venta","ya_tiene_servicio"]);
const protectedLabels = new Set(["asignado","predictivo","reasignado","cliente","venta"]);
export const stopLabels = new Set(["cerrado","chat_basura","no_quiere_el_servicio","rechazado","venta","validacion"]);

function labelsFromConversation(conversation) {
  for (const value of [conversation?.labels, conversation?.meta?.labels, conversation?.conversation?.labels]) {
    if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : item?.title || item?.name).filter(Boolean);
  }
  return [];
}

export class LabelService {
  constructor(api) { this.api = api; }
  async mergeSafe(id, add = [], remove = [], conversation = null) {
    try { return await this.merge(id, add, remove); }
    catch (error) {
      console.warn(`Aviso etiquetas ${id}: ${error.message}. La conversación continuará.`);
      const next = new Set(labelsFromConversation(conversation).filter(label => allowed.has(label)));
      for (const label of remove) if (!protectedLabels.has(label)) next.delete(label);
      for (const label of add) if (allowed.has(label)) next.add(label);
      return [...next];
    }
  }
  async merge(id, add = [], remove = []) {
    const response = await this.api.getLabels(id);
    const current = Array.isArray(response?.payload) ? response.payload : [];
    const next = new Set(current.filter(label => allowed.has(label)));
    for (const label of remove) if (!protectedLabels.has(label)) next.delete(label);
    for (const label of add) if (allowed.has(label)) next.add(label);
    if ([...next].sort().join("|") !== [...current].sort().join("|")) await this.api.setLabels(id, [...next]);
    return [...next];
  }
}
