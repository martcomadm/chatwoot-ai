# MARTCOM Chatwoot AI V2.5

## Cambios principales

- Buffer de mensajes de 3 segundos para agrupar mensajes consecutivos del cliente.
- Extracción híbrida: reglas rápidas para nombre, edad, IMSS, actividad, CURP, NSS, AFORE e intereses; OpenAI para datos ambiguos.
- Memoria ampliada con identidad, contexto laboral, intereses, plan recomendado, temperatura comercial y siguiente paso.
- Motor comercial determinista que decide qué dato falta y evita cuestionarios rígidos.
- Control de calidad antes de enviar respuestas: bloquea preguntas repetidas, frases robóticas y múltiples preguntas.
- Uso ocasional del primer nombre, sin repetir el nombre completo.
- Detección del caso “tengo empleo pero no me dan seguro”.
- Recomendación interna de Plan 2 cuando existe interés en INFONAVIT o AFORE.

## Archivos nuevos

- `src/fast-extractor.js`
- `src/sales-engine.js`
- `src/quality-checker.js`

## Actualización desde V2.4.1

Reemplaza todo el contenido del repositorio con esta versión. Conserva tus valores reales de EasyPanel.

Variable nueva:

```env
AI_MESSAGE_BUFFER_MS=3000
```

El volumen persistente sigue siendo:

```text
/app/data
```

Y la memoria:

```env
MEMORY_FILE=/app/data/conversation-memory.json
```
