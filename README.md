# MARTCOM AI Sales Intelligence V3.0.0

Primera fase de la V3: nueva arquitectura modular.

## Objetivo

Conservar el comportamiento estable de la V2.5.5, pero separar las responsabilidades para poder añadir después:

- Intent Engine.
- Emotion Engine.
- Objection Engine.
- Biblioteca de casos exitosos.
- Seguimientos inteligentes.
- Métricas comerciales.

## Estructura

```text
src/
├── server.js
├── config.js
├── routes.js
├── ai/
│   ├── json.js
│   ├── quality-checker.js
│   └── services.js
├── chatwoot/
│   ├── api.js
│   └── labels.js
├── core/
│   ├── conversation-processor.js
│   ├── fallback.js
│   └── message-buffer.js
├── knowledge/
│   └── martcom.js
├── memory/
│   ├── agent-rotation-store.js
│   ├── fast-extractor.js
│   └── memory-store.js
├── sales/
│   └── sales-engine.js
└── utils/
    └── conversation.js
```

## Funciones conservadas

- Solo atiende el inbox y usuario configurados.
- Buffer para agrupar mensajes consecutivos.
- Respaldo desde webhook cuando Chatwoot devuelve 403.
- Memoria persistente por conversación.
- Rotación Susana Solis → Carlos Ruiz → Jozic Martinez.
- Extracción híbrida de datos.
- Planner comercial.
- Verificación de calidad y fallback.
- Transferencia orgánica con nota privada.
- Etiquetas de detención.

## Implementación

Esta versión utiliza las mismas variables y el mismo volumen `/app/data` que la V2.5.5.

1. Sustituye el contenido del repositorio por este paquete.
2. Conserva las variables actuales.
3. Conserva el volumen persistente montado en `/app/data`.
4. Implementa en EasyPanel.

El log correcto es:

```text
MARTCOM AI V3.0.0 escuchando en puerto 3000
Arquitectura modular activa
```

## Siguiente fase

La V3.0.1 añadirá un Intent Engine separado, sin modificar el núcleo de Chatwoot, memoria o buffer.
