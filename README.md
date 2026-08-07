# MARTCOM AI V3.1.1 — Intent Engine

Esta versión incorpora el primer motor formal de intenciones de MARTCOM AI.

## Funciones nuevas

- Clasificación determinista de más de 25 tipos de intención.
- Puntaje de confianza, prioridad, familia y evidencia observable.
- Persistencia de la intención en `conversation-memory.json`.
- Evento `intent_classified` visible en el Inspector.
- Visualización de intención y confianza en `/inspector`.
- Conservación de una intención específica ante respuestas breves como “sí” o “no”.
- Primer flujo especializado para retiro de AFORE por fallecimiento.

## Flujo especializado: AFORE por fallecimiento

Cuando detecta `RETIRO_AFORE_FALLECIMIENTO`, MARTCOM AI no debe pedir:

- actividad laboral;
- edad para cotización;
- CURP para afiliación;
- NSS para cotización;
- información sobre planes comerciales.

El flujo recopila únicamente:

1. Si el fallecido tenía IMSS al momento del fallecimiento.
2. Si ya acudieron a la AFORE.
3. El motivo informado cuando hubo negativa de pensión.
4. Los posibles beneficiarios.
5. Entrega orgánica al asesor humano.

## Archivos nuevos

```text
src/intent/catalog.js
src/intent/rules.js
src/intent/intent-engine.js
src/intent/flows.js
tests/intent-engine.test.js
```

## Archivos modificados

```text
src/core/conversation-processor.js
src/core/fallback.js
src/memory/fast-extractor.js
src/memory/memory-store.js
src/ai/services.js
src/sales/sales-engine.js
src/inspector/page.js
src/routes.js
src/server.js
package.json
CHANGELOG.md
```

## Variables de EasyPanel

No se requieren variables nuevas. Conserva la configuración actual y el volumen `/app/data`.

## Verificación

El log correcto debe mostrar:

```text
MARTCOM AI V3.1.1 escuchando en puerto 3000
Arquitectura modular activa
Inspector: /inspector
```

Ejecuta antes del despliegue:

```bash
npm run check
npm test
```

## Prueba funcional principal

Mensaje:

```text
Quiero retirar el AFORE porque mi papá falleció.
```

Resultado esperado en el Inspector:

```text
Intención: Retiro de AFORE por fallecimiento
Prioridad: alta
Confianza: superior al 90 %
Fase: orientación especializada
```

La primera pregunta deberá relacionarse con la situación del fallecido, no con una cotización de afiliación.


## Inspector V1.1

La ruta `/inspector` ahora incluye dashboard, filtros, expediente por pestañas, explicación auditable de decisiones, alertas de calidad y diagnóstico del sistema. Continúa siendo de solo lectura.
