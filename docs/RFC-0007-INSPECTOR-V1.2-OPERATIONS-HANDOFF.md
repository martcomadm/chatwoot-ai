# RFC-0007 — Inspector V1.2: Operations & Handoff Observatory

**Core:** MARTCOM AI V3.2.1  
**Inspector:** V1.2.0  
**Modo:** solo lectura

## Objetivo
Convertir el Inspector en una consola de observabilidad operativa sin introducir acciones que puedan modificar Chatwoot, memoria o rotaciones.

## Capacidades
- Estado del sistema y último evento.
- Embudo Entrada → Diagnóstico → Datos → Validación → Resumen → Handoff.
- Estado de slots: confirmado, inferido, pendiente y no disponible.
- Vista Conversation Orchestrator.
- Handoff: asesor real, ID, turno, posición, motivo, hora y error.
- Rotación por weekday/saturday/sunday con último y siguiente asesor.
- Distribución de handoffs por asesor.
- Timeline técnico categorizado.
- Alertas de memoria, calidad, frustración y handoff.

## Regla de seguridad
El Inspector no contiene endpoints de escritura. No reasigna conversaciones, no altera memoria y no modifica la rotación.
