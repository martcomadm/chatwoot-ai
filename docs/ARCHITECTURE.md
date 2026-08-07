# MARTCOM AI — Architecture

## Propósito
Definir una arquitectura modular, observable y estable para MARTCOM AI.

## Principios
1. Una responsabilidad por módulo.
2. Nada entra a producción si no puede observarse desde el Inspector.
3. Estabilidad antes que nuevas funciones.
4. La memoria persistente es la fuente de estado.
5. El Planner decide; el generador redacta.
6. El Intent Engine clasifica el tipo de caso antes del flujo comercial.
7. El Semantic Engine normaliza significado, resuelve conflictos y slots.
8. El Inspector es de solo lectura.
9. Toda decisión relevante debe generar eventos auditables.

## Flujo general
```text
Cliente
  ↓
Chatwoot Webhook
  ↓
Message Buffer
  ↓
Intent Engine
  ↓
Semantic Engine
  ↓
Memory Engine
  ↓
Conversation Planner
  ↓
AI Response Generator
  ↓
Quality Checker
  ↓
Chatwoot Adapter
  ↓
Cliente

En paralelo:
Memoria / Intent / Planner / Calidad / Errores
                ↓
             Inspector
```

## Módulos
### Core Engine
Webhooks, buffer, concurrencia, horarios y orquestación.

### Intent Engine
Clasifica intención, confianza, evidencia y familia de flujo.

### Semantic Engine
Normaliza equivalencias, detecta contradicciones reales, valida nombres y resuelve slots.

### Memory Engine
Persiste perfil, contexto, preguntas resueltas y estado conversacional.

### Sales Engine
Interpreta señales comerciales, temperatura y recomendación de plan.

### Conversation Planner
Decide la siguiente acción y una sola pregunta principal.

### AI Engine
Redacta respuestas naturales con el contexto ya decidido.

### Quality Engine
Bloquea repeticiones, firmas accidentales y respuestas robóticas; repara o usa fallback.

### Chatwoot Adapter
Mensajes, etiquetas, notas y fallbacks de lectura.

### Inspector
Visualiza memoria, intención, planner, timeline, alertas y diagnóstico. Solo lectura.

### Simulator
Planificado. Pruebas sin afectar producción.

### Learning Engine
Planificado. Biblioteca comercial, comparación IA vs humano y sugerencias de mejora.

## Persistencia
- `/app/data/conversation-memory.json`
- `/app/data/agent-rotation.json`
- `/app/data/inspector-events.json`

## Observabilidad mínima
- webhook_received
- buffer_started
- buffer_flushed
- intent_classified
- semantic_normalized
- conflict_detected
- conflict_resolved
- memory_updated
- planner_decision
- quality_checked
- quality_repair
- reply_sent
- handoff_started
- handoff_completed
- chatwoot_error
- openai_error

## Política de estabilidad
Toda nueva función debe:
1. Tener pruebas.
2. Exponer estado al Inspector.
3. Tener rollback.
4. Mantener fallbacks existentes.
5. No bloquear una conversación por un error secundario.
