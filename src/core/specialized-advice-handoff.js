function norm(value=""){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}

export function specializedAdviceHandoff(text="", memory={}){
  const v=norm(text);
  if(!v) return null;

  // Mia keeps general education and ordinary sales questions. Escalation is
  // reserved for individualized analysis that would require records, a
  // calculation, interpretation, verification or a specialist conclusion.
  const pensionTopic=/\b(?:pension|pensionarme|jubilacion|modalidad 40|ley 73|ley 97)\b/.test(v);
  const personalCalculation=/\b(?:cuanto me (?:queda|quedaria|darian|dara|tocaria)|calcula(?:r|me)?|calculo|proyeccion|proyecta(?:r|me)?|monto exacto|cuanto voy a recibir|cuanto recibiria)\b/.test(v);
  const recordAnalysis=/\b(?:mis semanas|semanas cotizadas|historial|conservacion de derechos|regimen|salario promedio|promedio salarial|semanas reconocidas)\b/.test(v)
    && /\b(?:revis|analiz|calcul|verific|checa|evalua|cuanto|conviene|afecta)\w*\b/.test(v);
  const imssDiscrepancy=/\b(?:no coincide|no aparecen|faltan semanas|desconozco|duplicad|homonim|correccion de datos|regularizar|inconsisten|error en (?:mi )?(?:nss|curp|semanas|vigencia))\w*\b/.test(v);
  const verificationNeeded=/\b(?:puedes (?:consultar|revisar|verificar)|revisa (?:mi|mis)|consulta (?:mi|mis)|verifica (?:mi|mis))\b/.test(v)
    && /\b(?:nss|curp|vigencia|semanas|historial|pension|imss)\b/.test(v);

  if(pensionTopic && personalCalculation) return {reason:"El cliente requiere una proyección o cálculo individual de pensión.",kind:"specialized_pension"};
  if(recordAnalysis) return {reason:"El cliente requiere análisis individual de semanas o historial ante el IMSS.",kind:"specialized_record_review"};
  if(imssDiscrepancy) return {reason:"El cliente reporta una inconsistencia que requiere revisión especializada.",kind:"specialized_discrepancy"};
  if(verificationNeeded) return {reason:"La consulta requiere verificar datos individuales que Mía no puede consultar directamente.",kind:"specialized_verification"};

  return null;
}
