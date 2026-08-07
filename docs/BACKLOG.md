# MARTCOM AI — Backlog

## Convenciones
Prioridad: P0 crítico, P1 alta, P2 media, P3 futura.
Estado: TODO, DESIGN, DEVELOPMENT, TEST, STAGING, DONE.

## P0
### BUG-001 — Falsas contradicciones laborales
Caso:
- "No tengo trabajo"
- "Estoy desempleado"
Esperado: `tipo_trabajo=desempleado` y sin contradicción.

### BUG-002 — Bucle de aclaración
Esperado: máximo una aclaración por conflicto.

### BUG-003 — Nombre falso
Caso: "Ya te había dicho que estoy desempleado"
Esperado: nunca guardar como nombre.

## P1
### FEAT-001 — Semantic Normalizer
### FEAT-002 — Conflict Resolver 2.0
### FEAT-003 — Name Extractor 2.0
### FEAT-004 — Slot Filling
Caso: "No tengo NSS, pero te puedo dar mi CURP"
Esperado: aceptar CURP y continuar.
### FEAT-005 — Resolved Questions
### FEAT-006 — Semantic Inspector

## P2
### FEAT-010 — Intenciones secundarias
### FEAT-011 — Alertas de frustración
### FEAT-012 — Métrica preguntas evitadas
### FEAT-013 — Métrica falsos conflictos evitados
### FEAT-014 — Simulator

## P3
### FEAT-020 — Success Library
### FEAT-021 — AI vs Human Comparator
### FEAT-022 — Commercial Scoring
### FEAT-023 — Follow-up Intelligence
### FEAT-024 — Learning Recommendations

## Tests de regresión obligatorios
### TEST-001
"No tengo trabajo" + "Estoy desempleado" → sin contradicción.

### TEST-002
"Estoy desempleado" + "Ahora sí estoy trabajando" → conflicto real o actualización contextual.

### TEST-003
"Ya te había dicho que estoy desempleado" → no guardar como nombre.

### TEST-004
"No tengo NSS, pero te puedo dar mi CURP" → aceptar slot CURP.

### TEST-005
"Quiero retirar el AFORE porque mi papá falleció" → flujo especializado, sin preguntas de afiliación irrelevantes.
