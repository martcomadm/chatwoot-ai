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
    && /\b(?:revis|analiz|calcul|verific|checa|evalua|cuanto|conviene|afecta)\w*\b/.test(v.replace(/\bcuanto (?:me |te |le )?(?:cuesta|cobran|cobra|sale|costaria|pagaria|pago|seria el costo)\b/g, " "));
  // "Me faltan semanas" (para pensionarse) es una venta, y las semanas que no aparecen se aclaran en la
  // clínica del IMSS ya activo con nosotros (respuesta confirmada 20-oct): ninguna de las dos se canaliza.
  // "Desconozco totalmente ese tema" (caso real 21-oct) no es una inconsistencia.
  const imssDiscrepancy=/\b(?:no coincide|desconozco (?:esas |las |unas |ese |el )?(?:semanas|periodo|patron|empresa|alta|movimiento)|duplicad|homonim|correccion de datos|regularizar|inconsisten|error en (?:mi )?(?:nss|curp|semanas|vigencia))\w*\b/.test(v);
  const verificationNeeded=/\b(?:puedes (?:consultar|revisar|verificar)|revisa (?:mi|mis)|consulta (?:mi|mis)|verifica (?:mi|mis))\b/.test(v)
    && /\b(?:nss|curp|vigencia|semanas|historial|pension|imss)\b/.test(v);

  // Pensión por invalidez y unificación de números de seguridad social: los revisa una persona
  // (casos reales 24 y 25-oct: recibieron tres veces la respuesta de cirugías o solo los precios).
  const disabilityPension=/\b(?:pension\w*|pensionarme)\b.{0,25}\b(?:invalidez|incapacidad permanente)\b|\binvalidez\b/.test(v);
  const unifyNss=/\bunific\w*\b.{0,40}\b(?:semanas|nss|numeros?|cuentas?)\b|\b(?:numero|nss)\b.{0,30}\b(?:viejo|anterior|perdido|antiguo)\b.{0,60}\b(?:encontrar|localizar|recuperar|unific\w*|juntar)\b|\b(?:dos|2) (?:numeros de seguro|nss)\b/.test(v);
  if(disabilityPension) return {reason:"El cliente pregunta por una pensión por invalidez: requiere revisión de su caso.",kind:"specialized_disability_pension"};
  if(unifyNss) return {reason:"El cliente necesita localizar o unificar números de seguridad social.",kind:"specialized_nss_unification"};
  if(pensionTopic && personalCalculation) return {reason:"El cliente requiere una proyección o cálculo individual de pensión.",kind:"specialized_pension"};
  if(recordAnalysis) return {reason:"El cliente requiere análisis individual de semanas o historial ante el IMSS.",kind:"specialized_record_review"};
  if(imssDiscrepancy) return {reason:"El cliente reporta una inconsistencia que requiere revisión especializada.",kind:"specialized_discrepancy"};
  if(verificationNeeded) return {reason:"La consulta requiere verificar datos individuales que Mía no puede consultar directamente.",kind:"specialized_verification"};

  return null;
}
