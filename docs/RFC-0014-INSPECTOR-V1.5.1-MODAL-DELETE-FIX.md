# RFC-0014 — Inspector V1.5.1 Modal Stack & Delete Fix

## Correcciones
- El modal Agregar asesor siempre aparece por encima del Control Operativo.
- X, clic fuera y Escape cierran correctamente el modal superior.
- Quitar del turno desde menú contextual.
- Eliminar del catálogo desde el selector de asesores.
- No se permite eliminar del catálogo si el asesor todavía pertenece a una rotación o excepción.
- No se permite dejar una rotación sin asesores.

## Persistencia
Sin cambios: `/app/data/handoff-config.json`.

## Core
MARTCOM AI V3.3.0 sin cambios.
