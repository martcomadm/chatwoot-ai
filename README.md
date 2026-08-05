# MARTCOM AI V3.0.1 — Inspector Base

Conserva el motor V3.0.0 y agrega un Inspector de solo lectura.

## Nuevas rutas

- `/inspector` — interfaz web.
- `/inspector/api/health` — salud del sistema.
- `/inspector/api/conversations` — conversaciones en memoria.
- `/inspector/api/conversations/:id` — expediente, memoria y timeline.

## Variables nuevas

```env
INSPECTOR_EVENTS_FILE=/app/data/inspector-events.json
INSPECTOR_TOKEN=UNA_CLAVE_PRIVADA_LARGA
INSPECTOR_MAX_EVENTS_PER_CONVERSATION=200
```

El Inspector usa el mismo volumen persistente `/app/data`. No modifica conversaciones ni memoria.

## Implementación

1. Sustituye el repositorio por este paquete.
2. Conserva todas las variables actuales.
3. Agrega las tres variables del Inspector.
4. Implementa en EasyPanel.
5. Abre `https://TU-DOMINIO/inspector`.
6. Introduce el valor de `INSPECTOR_TOKEN`.

## Datos disponibles

- Perfil del cliente.
- Fase y siguiente paso.
- Plan recomendado y temperatura.
- Última pregunta y estado de documentos.
- Memoria JSON.
- Timeline de buffer, fallback, decisión, respuesta y transferencia.
