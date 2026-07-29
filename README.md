# MARTCOM Chatwoot AI V2.5.4

## Correcciones principales

- Las preguntas pendientes pueden reformularse cuando el cliente no las respondió directamente.
- El control de calidad ya no bloquea una respuesta solo porque comparte la misma `question_key`.
- Bloquea únicamente respuestas prácticamente idénticas a la última enviada.
- Si la reparación con OpenAI falla o sigue siendo rechazada, se genera una respuesta local de respaldo.
- El cliente nunca queda sin contestación por un rechazo del quality checker.
- Detección reforzada de:
  - altas o afiliación al IMSS;
  - aportaciones a AFORE;
  - continuidad de aportaciones;
  - “sin cambios cada semana”.
- Los mensajes sobre alta + AFORE se clasifican como interés en Plan 2.
- Conserva el buffer de mensajes, respaldo ante Chatwoot 403, memoria persistente y rotación de nombres.

## Caso corregido

Cliente:

`Necesito altas con aportaciones AFORE y que sean constantes sin cambios cada semana.`

Respuesta esperada:

`Entiendo: buscas que el alta y las aportaciones a tu AFORE tengan continuidad. Para revisar cuál opción corresponde, ¿actualmente tienes un alta activa ante el IMSS?`

## Implementación

Reemplaza los archivos del repositorio y vuelve a implementar en EasyPanel. No necesitas cambiar las variables de entorno.

El log de inicio debe mostrar:

`AXEL IA V2.5.4 escuchando en puerto 3000`

Cuando se active el respaldo de calidad aparecerá:

`Fallback calidad <conversationId>: ...`
