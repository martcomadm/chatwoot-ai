# MARTCOM Chatwoot AI V2.5.3

## Corrección principal

Esta versión corrige el caso donde Chatwoot devuelve `403` al consultar una conversación y el bot recibe el webhook, pero no responde porque `conversation.messages` llega vacío.

### Cambios

- Conserva dentro del buffer todos los mensajes `message_created` recibidos por webhook.
- Si la API de Chatwoot devuelve `403`, procesa directamente esos mensajes en lugar de depender de `conversation.messages`.
- Agrupa correctamente varios mensajes enviados durante los 3 segundos del buffer.
- Deduplica los mensajes por ID.
- Un mensaje se marca como procesado únicamente después de enviar correctamente la respuesta o completar la transferencia.
- Si OpenAI, Chatwoot o el envío fallan, el mensaje no queda falsamente marcado como atendido.
- Mantiene memoria persistente, motor comercial, control de calidad y rotación round robin:
  - Susana Solis
  - Carlos Ruiz
  - Jozic Martinez

## Variables

No es necesario cambiar las variables actuales:

```env
AI_TIMEZONE=America/Mexico_City
AI_START_HOUR=0
AI_END_HOUR=24
AI_MESSAGE_BUFFER_MS=3000
MEMORY_FILE=/app/data/conversation-memory.json
AGENT_ROTATION_FILE=/app/data/agent-rotation.json
AI_INTRO_AGENTS=Susana Solis,Carlos Ruiz,Jozic Martinez
```

El volumen persistente sigue siendo:

```text
/app/data
```

## Logs esperados

Al iniciar:

```text
AXEL IA V2.5.3 escuchando en puerto 3000
Buffer de mensajes: 3000 ms
Memoria persistente: /app/data/conversation-memory.json
Rotación de presentación: Susana Solis -> Carlos Ruiz -> Jozic Martinez
```

Cuando Chatwoot rechace la lectura, pero el webhook tenga el mensaje:

```text
Aviso lectura 6250: Chatwoot 403: null. Se usará el contenido del webhook.
Respaldo webhook 6250: procesando 1 mensaje(s) entrante(s) sin consultar historial.
```

Después debe aparecer un evento `processed` o `handoff`.

## Implementación

Reemplaza todo el contenido del repositorio con los archivos de este paquete y vuelve a implementar el servicio en EasyPanel.
