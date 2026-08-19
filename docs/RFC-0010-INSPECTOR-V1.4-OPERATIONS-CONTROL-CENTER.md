# RFC-0010 — Inspector V1.4 Operations Control Center

## Objetivo
Convertir el Inspector en un centro operativo controlado sin modificar el Core conversacional V3.3.0.

## Capacidades
- Filtrar conversaciones y métricas por fecha.
- Presets Hoy, Ayer, 7 días, 30 días y Todo.
- Ordenar por fecha, ID, nombre o alertas.
- Reordenar asesores en weekday/saturday/sunday.
- Activar o desactivar asesores sin redeploy.
- Excepciones de rotación por fecha.
- Auditoría de cambios.
- Persistencia en `/app/data/handoff-config.json`.

## Seguridad
`INSPECTOR_TOKEN` conserva acceso de lectura.
`INSPECTOR_ADMIN_TOKEN` es obligatorio para cambios operativos.

## Fuente de verdad
Las variables `HANDOFF_*_AGENTS` se usan como configuración inicial/fallback.
Una vez creado `handoff-config.json`, el router utiliza esa configuración dinámica.

## Rollback
Eliminar o renombrar `handoff-config.json` hace que la siguiente inicialización vuelva a sembrar la configuración a partir de las variables de entorno.
