# RFC-0015 — Inspector V1.5.2 Interaction Wiring Fix

## Problema
La V1.5/V1.5.1 contenía las funciones de interacción, pero varios listeners no quedaron registrados en `bindUi`.
La interfaz mostraba botones funcionales visualmente sin ejecutar acciones.

## Correcciones
- X del modal Agregar asesor.
- Clic fuera del modal.
- Escape.
- Agregar asesor existente.
- Eliminar asesor del catálogo.
- Quitar del turno.
- Mover/copiar entre turnos.
- Drag & drop.
- Activar/desactivar.
- Guardar orden.
- Buscador.
- Creación manual por ID Chatwoot + nombre.

## Core
MARTCOM AI V3.3.0 sin cambios.
