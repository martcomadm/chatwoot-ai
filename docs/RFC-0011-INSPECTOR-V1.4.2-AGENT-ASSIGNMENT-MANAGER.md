# RFC-0011 — Inspector V1.4.2 Agent Assignment Manager

## Objetivo
Permitir mover o copiar asesores entre WEEKDAY, SATURDAY y SUNDAY desde el Operations Control Center.

## Funciones
- Mover asesor entre grupos.
- Copiar asesor a otro grupo.
- Lista maestra de asesores.
- Protección contra IDs duplicados.
- No permite dejar una rotación vacía.
- Persistencia inmediata en `/app/data/handoff-config.json`.
- Auditoría de movimientos y copias.

## Seguridad
Todas las escrituras requieren `INSPECTOR_ADMIN_TOKEN`.

## Compatibilidad
Core V3.3.0 sin cambios.
