# MARTCOM AI Next — V1 Sales Foundation

## Objetivo
Desarrollar una segunda evolución de MARTCOM AI sin modificar ni desplegar cambios sobre la instancia productiva actual.

## Aislamiento
- `main`: producción estable. No se modifica desde este trabajo.
- `next`: línea permanente de MARTCOM AI Next.
- `feat/next-v1-sales-foundation`: desarrollo de la primera fase.
- El futuro servicio `chatwoot-ai-next` debe utilizar webhook, inbox de pruebas, variables y almacenamiento `/app/data` independientes de producción.

## Planes oficiales
### Plan 1 — $1,100 MXN
- Salario diario registrado: $480 MXN.
- Semanas cotizadas.
- Seguro médico IMSS.
- Beneficiarios conforme a validación aplicable.
- Atención médica, medicamentos, estudios, cirugías, hospitalización, especialidades, maternidad y guardería conforme a reglas del IMSS.

### Plan 2 — $1,500 MXN
- Salario diario registrado: $480 MXN.
- Incluye la base de servicio médico y semanas.
- Referencia operativa AFORE: 5.15%.
- INFONAVIT conforme a reglas aplicables.
- Incapacidades conforme a reglas del IMSS.

## Estrategia comercial inicial
- Servicio médico/semanas/beneficiarios: orientar inicialmente a Plan 1.
- AFORE o INFONAVIT: orientar a Plan 2.
- Preguntas de precio: responder con los importes oficiales, no usar el antiguo fallback de precio variable.
- No inventar descuentos, promociones o prestaciones.

## Proveedor / asesor
Solicitudes para vender, revender, distribuir, comercializar u ofrecer afiliaciones como asesor/proveedor son B2B y deben producir handoff inmediato y etiqueta `proveedor`.

## Postventa
Next conoce el proceso aproximado de 48 horas hábiles, validación por correo configurado, política operativa de pago, términos, reingresos y restricciones de incapacidades/cartas patronales.

## Regla de seguridad
Ningún cambio de Next debe desplegarse en el servicio productivo `chatwoot-ai` durante desarrollo y pruebas. La promoción de funciones a producción será una decisión separada y explícita.
