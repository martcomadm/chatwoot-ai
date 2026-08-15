# MARTCOM AI V3.2.2 — Advisor Affinity

V3.2.2 unifica la identidad de presentación de MARTCOM AI con el asesor humano real que recibirá la conversación.

## Cambio principal

El asesor se reserva cuando inicia la conversación. La IA se presenta con ese nombre y el handoff se realiza al mismo `assignee_id`.

```text
Nueva conversación
  ↓
Asesor reservado
  ↓
Presentación con ese nombre
  ↓
Diagnóstico
  ↓
Resumen privado
  ↓
Handoff al mismo asesor
```

## Variables de turno

```env
AUTO_HANDOFF=true
HANDOFF_WEEKDAY_AGENTS=25:Elizabeth Aguilera,20:Jonathan Nuñez,31:Tonatiuh Ramirez,40:Alberto Gonzalez,26:Pamela Montiel,32:Vicente Martinez
HANDOFF_SATURDAY_AGENTS=40:Alberto Gonzalez,26:Pamela Montiel,32:Vicente Martinez
HANDOFF_SUNDAY_AGENTS=25:Elizabeth Aguilera,20:Jonathan Nuñez,31:Tonatiuh Ramirez
HANDOFF_ROTATION_FILE=/app/data/handoff-rotation.json
```

`AI_INTRO_AGENTS` queda únicamente como fallback de compatibilidad. En operación normal, los nombres `HANDOFF_*` son la fuente de verdad para presentación y handoff.

## Memoria persistente

No eliminar ni recrear el volumen `/app/data`. V3.2.2 agrega `advisor_affinity` a la memoria existente de manera compatible.

## Inspector

Inspector 1.2.1 muestra asesor reservado, ID, presentación IA, asesor del handoff, coincidencia y posición de rotación.

## Compatibilidad

Las conversaciones anteriores conservan su historial. Si una conversación vieja ya se presentó con un nombre compatible con un asesor real del turno, el sistema intenta vincularlo sin modificar los mensajes anteriores.

## Validación

Ejecutar:

```bash
npm test
npm run check
```
