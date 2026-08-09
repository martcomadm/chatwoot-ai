# RFC-0002 — Intent Engine V3.1.0

## Objetivo

Clasificar el tipo de caso antes de ejecutar el planner comercial.

## Decisión

Se utiliza un clasificador híbrido cuya primera capa es determinista y no consume API. Cada regla aporta un puntaje. El resultado contiene intención, confianza, familia, prioridad y evidencia.

## Alcance inicial

El catálogo incluye intenciones comerciales, pensión, AFORE, fallecimiento, salud, operación y servicio. La primera implementación especializada corresponde a retiro de AFORE por fallecimiento.

## Observabilidad

Cada clasificación se almacena en memoria y genera un evento `intent_classified` para el Inspector.

## Riesgos controlados

- Una intención específica no se degrada por respuestas cortas posteriores.
- Los datos del fallecido se almacenan separados de los datos del cliente.
- El flujo especializado bloquea preguntas comerciales incompatibles.

## Rollback

Volver a V3.0.1.2 conservando `/app/data`. Los nuevos campos de memoria serán ignorados por la versión anterior.
