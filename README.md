# MARTCOM AI V3.2.1 — Automatic Handoff Router

Esta versión mantiene el Conversation Orchestrator V3.2.0 y agrega asignación automática al asesor humano después del resumen privado de AXEL IA.

## Flujo

```text
Cliente
  ↓
MARTCOM AI
  ↓
Diagnóstico / Intent / Memory / Planner
  ↓
Handoff requerido
  ↓
Etiqueta validacion
  ↓
Mensaje orgánico al cliente
  ↓
AXEL IA - RESUMEN (nota privada)
  ↓
Automatic Handoff Router
  ↓
Asesor humano de Chatwoot
```

## Rotación real confirmada

### Domingo
1. Elizabeth Aguilera — ID 25
2. Jonathan Nuñez — ID 20
3. Tonatiuh Ramirez — ID 31

### Sábado
1. Alberto Gonzalez — ID 40
2. Pamela Montiel — ID 26
3. Vicente Martinez — ID 32

La rotación de presentación `AI_INTRO_AGENTS` sigue siendo independiente.

## Variables nuevas

```env
AUTO_HANDOFF=true
HANDOFF_SUNDAY_AGENTS=25:Elizabeth Aguilera,20:Jonathan Nuñez,31:Tonatiuh Ramirez
HANDOFF_SATURDAY_AGENTS=40:Alberto Gonzalez,26:Pamela Montiel,32:Vicente Martinez
HANDOFF_WEEKDAY_AGENTS=
HANDOFF_ROTATION_FILE=/app/data/handoff-rotation.json
```

`HANDOFF_WEEKDAY_AGENTS` queda vacío intencionalmente hasta definir el turno real de lunes a viernes. En esos días el sistema genera resumen y `validacion`, pero no inventa una asignación automática.

## Persistencia

La posición se conserva en:

```text
/app/data/handoff-rotation.json
```

Un reinicio del contenedor no reinicia la rotación.

## Seguridad de la rotación

El contador solo avanza si Chatwoot confirma la asignación. Si la API devuelve 401/403/404/500 o falla por red:

- no avanza la rotación;
- guarda `handoff.status = pending`;
- conserva el asesor que tocaba;
- registra el error en Inspector;
- reintenta ante el siguiente evento entrante mientras la conversación continúe asignada a AXEL IA.

## Inspector

El expediente muestra:

- estado de handoff;
- asesor humano real;
- ID Chatwoot;
- grupo saturday/sunday/weekday;
- posición en la rotación;
- fecha de asignación;
- último error.

Eventos nuevos:

- `handoff_summary_created`
- `handoff_assignment_started`
- `handoff_assignment_completed`
- `handoff_assignment_failed`
- `handoff_assignment_skipped`

## Chatwoot

La reasignación usa el endpoint oficial:

```text
POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/assignments
```

con `assignee_id`.

El `CHATWOOT_ACCESS_TOKEN` debe tener permisos suficientes para reasignar conversaciones.
