## Inspector V1.4.2 — Agent Assignment Manager
- Mover asesores entre WEEKDAY/SATURDAY/SUNDAY.
- Copiar asesores sin retirarlos del grupo original.
- Lista maestra de asesores.
- Prevención de duplicados por ID.
- Auditoría de movimientos y copias.

## Inspector V1.4.1 — Control Modal Fix
- Corrige botón Control Operativo sin respuesta.
- Restaura listeners del modal, presets de fecha y ordenamiento.
- Enter en token administrador abre el control.
- Clic fuera del modal lo cierra.

## Inspector V1.4 — Operations Control Center
- Filtros por fecha y ordenamiento.
- Rotación editable desde Inspector.
- Activar/desactivar asesores.
- Excepciones por fecha.
- Token administrador separado.
- Configuración persistente en /app/data/handoff-config.json.

# CHANGELOG

## V3.3.0 — Conversational Judgment Engine
- Question Priority Engine.
- Human Preference handoff.
- Price/Trust objection routing.
- Slot Governance (`ask_later`, `unavailable`, `refused`).
- Subject Resolver V2.
- Protection against courtesy phrases as names.
- Inspector 1.3 judgment observability.
- No destructive memory migration.


## V3.2.2 — Advisor Affinity
- El asesor real se reserva al inicio de la conversación.
- MARTCOM AI se presenta con el nombre del asesor reservado.
- El handoff usa exactamente el mismo `assignee_id`.
- La rotación avanza al reservar, no al transferir.
- Reintentos de handoff conservan el asesor reservado.
- Persistencia de reservas en `handoff-rotation.json`.
- Compatibilidad con conversaciones antiguas.
- Inspector 1.2.1 agrega verificación de coincidencia presentación/handoff.
- Nuevos eventos `advisor_affinity_*`.

# Inspector V1.2 — Operations & Handoff Observatory

- Mantiene Core MARTCOM AI V3.2.1.
- Añade observabilidad de handoff y rotación real.
- Añade embudo de conversación y estados de slots.
- Añade métricas de distribución por asesor.
- Añade vista del Conversation Orchestrator.
- Inspector continúa estrictamente en solo lectura.

# CHANGELOG

## V3.2.1 — Automatic Handoff Router
- Asignación automática después del resumen privado.
- Rotación dominical: Elizabeth (25), Jonathan (20), Tonatiuh (31).
- Rotación sabatina: Alberto Gonzalez (40), Pamela (26), Vicente (32).
- Persistencia independiente en `/app/data/handoff-rotation.json`.
- El contador solo avanza tras confirmación exitosa de Chatwoot.
- Handoff fallido queda pendiente y es observable/reintentable.
- Inspector muestra asesor real, turno, posición y errores de asignación.
- Días de semana permanecen sin asignación automática hasta configurar `HANDOFF_WEEKDAY_AGENTS`.

## V3.2.0 — Conversation Orchestrator
- Direct Answer First para preguntas explícitas.
- Trust Intent y B2B/Proveedor.
- Age Extractor V2.
- CURP Normalizer V2.
- Unavailable slots.
- Subject Resolver para casos de familiares.
- Multi-Fact Extraction.
- Nuevos eventos del Inspector.


## V3.1.2 — Conversation Reliability Engine
- Message deduplicator.
- Answer/Slot Resolver.
- Resolved Questions Guard.
- Name Extractor 2.0.
- Semantic Normalizer y conflictos deterministas.
- Frustration Circuit Breaker.
- Inspector actualizado con señales de confiabilidad.
- 18 pruebas automatizadas aprobadas.

## V3.1.1.1 — Inspector Frontend Fix
- JavaScript externo para evitar fallos del script inline.
- CSS externo.
- Token persistente en sessionStorage.
- Enter y botón Actualizar cargan el Inspector.
- Event delegation para conversaciones y pestañas.
- Ruta estática `/inspector/assets`.
- Sin cambios en el motor de atención.

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