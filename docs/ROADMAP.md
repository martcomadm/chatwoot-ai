# MARTCOM AI — Roadmap

## Estado actual
Arquitectura modular V3.x con memoria persistente, buffer, rotación, planner, quality checker, Inspector e Intent Engine inicial.

## V3.1.2 — Semantic Memory & Conflict Resolver
- Semantic Normalizer.
- Conflict Resolver 2.0.
- Name Extractor 2.0.
- Slot Filling.
- `resolved_questions`.
- Observabilidad semántica.

Criterios:
- "No tengo trabajo" = "Estoy desempleado".
- Contradicción real se pregunta máximo una vez.
- Frases conversacionales no se guardan como nombre.
- Si no hay NSS pero ofrece CURP, el flujo puede continuar.

## V3.1.3 — Specialized Intent Flows
Flujos prioritarios:
- Afiliación.
- Servicio médico.
- Pensión.
- Semanas.
- Reactivación.
- INFONAVIT.
- AFORE.
- Retiro AFORE por fallecimiento.

## V3.2.0 — Simulator
Probar mensajes, memoria, intención, planner, respuesta y calidad sin Chatwoot.

## V3.2.1 — Analytics
KPIs de conversaciones, transferencias, errores, tiempos, repeticiones evitadas e intenciones.

## V3.3.0 — Success Library
Biblioteca de conversaciones exitosas y respuestas humanas destacadas.

## V3.3.1 — AI vs Human Comparator
Comparar cómo mejoró el asesor humano una respuesta de IA.

## V3.4.0 — Commercial Scoring
Clasificación explicable: frío, templado, caliente, muy_caliente.

## V3.5.0 — Follow-up Intelligence
Seguimientos contextuales basados en memoria real.

## V4.0 — Adaptive Sales Intelligence
Integración de memoria semántica avanzada, biblioteca comercial, scoring y recomendaciones.
Toda mejora seguirá requiriendo aprobación humana antes de producción.
