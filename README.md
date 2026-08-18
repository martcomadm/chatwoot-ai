# MARTCOM AI V3.3.0 — Conversational Judgment Engine

V3.3.0 mantiene Advisor Affinity, Automatic Handoff, Conversation Orchestrator e Inspector y añade juicio conversacional determinista.

## Prioridad de conversación
1. Atención humana solicitada.
2. Pregunta explícita del cliente.
3. Objeción.
4. Corrección.
5. Datos nuevos.
6. Siguiente slot del planner.

## Nuevas protecciones
- Segunda insistencia de precio puede escalar a asesor humano.
- Preferencia por atención personal produce handoff inmediato.
- CURP/NSS pueden quedar `ask_later`, `unavailable` o `refused` y no se vuelven a solicitar en bucle.
- `Mil gracias` y frases de cortesía no pueden transformarse en nombre.
- Subject Resolver V2 distingue mejor casos para esposo/padre/etc.
- Preguntas como `Cotización de qué?` y `Qué es CURP?` tienen prioridad sobre el cuestionario.

## Persistencia
Conservar el volumen `/app/data`.
No se requieren variables nuevas.

## Inspector
Inspector 1.3 muestra señales de juicio, objeciones, preferencia humana y preguntas bloqueadas.


## Inspector V1.4
Filtro por fecha y Operations Control Center persistente. Requiere `INSPECTOR_ADMIN_TOKEN` para edición. La configuración se guarda en `/app/data/handoff-config.json`.
