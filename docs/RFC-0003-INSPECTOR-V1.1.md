# RFC-0003 — MARTCOM AI Inspector V1.1

## Objetivo
Convertir el Inspector Base en una consola interna de supervisión de solo lectura.

## Funciones nuevas
- Dashboard de conversaciones.
- Búsqueda y filtros por intención, asesor, fase y temperatura.
- Expediente con pestañas: Resumen, Intención, Planner/¿Por qué?, Timeline, Alertas, Memoria y Diagnóstico.
- Explicación auditable basada en eventos y memoria, sin exponer razonamiento privado del modelo.
- Alertas automáticas de preguntas repetidas, contradicciones, baja confianza, fallbacks y errores.
- Centro de diagnóstico del Core, OpenAI, Chatwoot, archivos persistentes, Intent Engine y buffer.
- Timeline enriquecido con eventos de memoria y control de calidad.

## Seguridad
Sigue protegido por INSPECTOR_TOKEN y permanece en modo solo lectura.

## Rollback
Volver a MARTCOM AI V3.1.0. Los archivos inspector-events.json y conversation-memory.json son compatibles.
