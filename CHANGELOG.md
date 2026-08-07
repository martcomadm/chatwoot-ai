# CHANGELOG

## 3.1.1

### Inspector 1.1
- Dashboard con KPIs operativos.
- Búsqueda y filtros por intención, asesor, fase y temperatura.
- Expediente por pestañas.
- Vista auditable “¿Por qué?”.
- Timeline enriquecido.
- Alertas de calidad.
- Centro de diagnóstico del sistema.
- Eventos `memory_updated`, `quality_checked`, `quality_repair` y `quality_fallback`.
- Pruebas del servicio del Inspector.

### Compatibilidad
- Conserva Intent Engine V3.1.0.
- No requiere variables nuevas.
- Inspector continúa en modo solo lectura.

## 3.1.0

### Nuevo

- Intent Engine basado en reglas y puntajes.
- Catálogo inicial de intenciones MARTCOM.
- Confianza, prioridad, evidencia y alternativas de clasificación.
- Persistencia y visualización de intención en el Inspector.
- Evento observable `intent_classified`.
- Flujo especializado para retiro de AFORE por fallecimiento.
- Pruebas automatizadas del Intent Engine.

### Corregido

- Los casos de AFORE por fallecimiento ya no siguen automáticamente el formulario de afiliación.
- Una respuesta “sí” sobre la afiliación del fallecido no se guarda como IMSS actual del cliente.
- Se evita pedir actividad, CURP o cotización en el flujo especializado.

### Compatibilidad

- Conserva la memoria existente de V3.0.1.2.
- No requiere nuevas variables de entorno.
- Conserva el Inspector y la corrección de firma del asesor.

## 3.0.1.2

- Compatibilidad de `memories.list()` para el Inspector.
- Corrección de errores al listar conversaciones.

## 3.0.1.1

- Eliminación automática de firmas accidentales del asesor.
