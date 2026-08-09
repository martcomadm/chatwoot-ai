# MARTCOM AI V3.1.2 — Conversation Reliability Engine

Esta versión prioriza la confiabilidad conversacional antes de agregar nuevas intenciones.

## Cambios principales

- Deduplicación temprana por `conversation_id + message_id`.
- Answer Resolver: respuestas cortas como `50`, `sí` y `no` se vinculan a la última pregunta.
- `resolved_questions`: un dato resuelto queda bloqueado técnicamente para futuras preguntas.
- Name Extractor 2.0: rechaza frases conversacionales como nombres.
- Semantic Normalizer: expresiones equivalentes de empleo se guardan igual.
- Conflict Resolver determinista: OpenAI ya no crea contradicciones por texto libre.
- Slot fallback: si no hay NSS pero el cliente ofrece CURP, el planner puede continuar.
- Frustration Circuit Breaker: si el cliente demuestra frustración alta, se detiene el interrogatorio y se entrega el caso a una persona.
- Nuevos eventos para Inspector: `answer_resolved`, `semantic_normalized`, `semantic_equivalent`, `semantic_conflict_detected`, `resolved_question_blocked`, `frustration_detected`, `frustration_handoff`.

## Compatibilidad

No requiere variables nuevas. Conserva `/app/data` y el formato de memoria anterior; los campos nuevos son opcionales y se rellenan automáticamente.

## Pruebas críticas incluidas

- `No tengo trabajo` = `Estoy desempleado`.
- `50` responde a una pregunta de edad.
- `Siii` responde al slot que acababa de preguntarse.
- `Manejo un taxi` no puede convertirse en nombre.
- `Requiero asesoría para mi pensión` no puede convertirse en nombre.
- Una edad resuelta no vuelve a ser seleccionada por el planner.
- El mismo `message_id` no produce dos ejecuciones del buffer.
- Frustración por repetición activa el circuito de protección.

## Deploy

Reemplazar el código por este release, conservar variables y volumen, e implementar en EasyPanel.

Log esperado:

```text
MARTCOM AI V3.1.2 escuchando en puerto 3000
Arquitectura modular activa
Inspector: /inspector · versión 1.1
```
