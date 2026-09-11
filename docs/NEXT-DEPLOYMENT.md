# MARTCOM AI Next — despliegue aislado en EasyPanel

## Objetivo
Desplegar `chatwoot-ai-next` sin modificar ni compartir estado con `chatwoot-ai` de producción.

## Reglas no negociables
- Producción (`chatwoot-ai`) permanece intacta.
- NEXT usa un Inbox de laboratorio distinto de Inbox 6.
- NEXT usa un usuario/agente IA distinto al AXEL IA de producción cuando sea posible.
- NEXT usa webhook propio y secreto propio.
- NEXT monta un volumen propio en `/app/data-next`.
- Nunca montar el volumen de producción en NEXT.
- `APP_ENV=next` y `ALLOWED_INBOX_IDS` son obligatorios.
- El proceso falla al arrancar si se configura Inbox 6, un inbox no autorizado o almacenamiento fuera de `NEXT_DATA_DIR`.

## 1. Preparar Chatwoot
1. Crear un Inbox exclusivo de laboratorio, por ejemplo `MARTCOM NEXT LAB`.
2. Anotar su ID. Debe ser diferente de `6`.
3. Crear/seleccionar un usuario IA exclusivo de pruebas, por ejemplo `Mia de MARTCOM - NEXT`.
4. Añadirlo únicamente al Inbox de laboratorio necesario para las pruebas.
5. Obtener un token de acceso apropiado para NEXT. No documentarlo en Git.
6. No registrar todavía el webhook hasta que el servicio NEXT haya pasado `/health`.

## 2. Crear servicio EasyPanel
Crear un servicio nuevo llamado `chatwoot-ai-next` dentro del proyecto permitido por la instalación actual.

Repositorio: `martcomadm/chatwoot-ai`

Branch de laboratorio durante esta fase: `feat/next-v1-sales-foundation`

Puerto interno: `3000`

El Dockerfile ya utiliza Node 24 y crea `/app/data-next`.

## 3. Volumen persistente
Crear un volumen exclusivo de NEXT y montarlo:

- destino contenedor: `/app/data-next`
- NO usar `/app/data`
- NO reutilizar `chatwoot-bots_chatwoot-ai_data`

Después del primer arranque deben aparecer dentro de ese volumen, según uso:
- `conversation-memory.json`
- `agent-rotation.json`
- `handoff-rotation.json`
- `inspector-events.json`
- `handoff-config.json`
- `sales.json`

## 4. Variables
Partir de `.env.next.example`.

Obligatorias de aislamiento:
```env
APP_ENV=next
NEXT_DATA_DIR=/app/data-next
CHATWOOT_INBOX_ID=<ID_INBOX_LAB>
ALLOWED_INBOX_IDS=<ID_INBOX_LAB>
```

`CHATWOOT_INBOX_ID` y `ALLOWED_INBOX_IDS` deben contener el inbox de laboratorio y nunca `6`.

Usar tokens/secrets exclusivos para NEXT. No copiar secrets a documentación, capturas o commits.

## 5. Primera prueba sin webhook
Desplegar el servicio antes de conectar Chatwoot.

Esperado en logs:
- `MARTCOM AI NEXT escuchando en puerto 3000`
- identidad pública de NEXT
- memoria bajo `/app/data-next`
- expedientes bajo `/app/data-next/sales.json`

Comprobar:
- `GET /health` responde `status: ok`.
- `GET /` reporta el inbox de laboratorio.
- Inspector requiere token.
- Operations requiere token.

Si el proceso no inicia, no eliminar los guards: corregir la configuración.

## 6. Pruebas negativas obligatorias
Antes de conectar el webhook, probar temporalmente y confirmar que el contenedor falla al iniciar con:
1. `APP_ENV=production`.
2. `CHATWOOT_INBOX_ID=6`.
3. `ALLOWED_INBOX_IDS=6`.
4. `CHATWOOT_INBOX_ID` distinto del permitido.
5. `NEXT_DATA_DIR=/app/data`.

Restaurar después la configuración correcta.

## 7. Conectar webhook de laboratorio
Una vez saludable, crear webhook de Chatwoot apuntando únicamente al servicio NEXT:

`POST https://<DOMINIO-NEXT>/webhook/chatwoot?secret=<WEBHOOK_SECRET_NEXT>`

Eventos requeridos por el código actual:
- `message_created`
- `conversation_updated`

El router descarta mensajes cuyo inbox no coincida con `CHATWOOT_INBOX_ID`.

## 8. Smoke test end-to-end
Usar exclusivamente un contacto/conversación de prueba en el Inbox LAB.

Verificar:
1. El mensaje llega a NEXT.
2. NEXT responde con su identidad pública y no se presenta como asesor humano.
3. La conversación queda en memoria NEXT.
4. Producción no crea/modifica memoria por esa conversación.
5. Autorización de venta crea un único `sale_id`.
6. CURP/NSS/documentos post-autorización alimentan el expediente y no provocan handoff automático.
7. Captura no completa si falta documentación.
8. Validación requiere sus cuatro checks.
9. Vigencia requiere documento/referencia.
10. Pago no puede solicitarse antes de vigencia.
11. Pago recibido exige comprobante.
12. Validación de pago cierra el expediente.
13. Operations se actualiza por SSE.
14. Los mensajes automáticos de avance ocurren solo después de eventos operativos reales.

## 9. Criterio de aprobación del laboratorio
No considerar NEXT listo para piloto hasta que:
- CI esté verde.
- guards negativos funcionen.
- smoke test completo pase.
- no exista escritura en volumen de producción.
- no exista respuesta en Inbox 6.
- no se compartan usuario IA/webhook/secret/volumen por accidente.
- se haya revisado Inspector y Operations con un expediente de prueba completo.

## Rollback
NEXT es un servicio independiente. Ante cualquier comportamiento inesperado:
1. desactivar/eliminar el webhook del Inbox LAB hacia NEXT;
2. detener `chatwoot-ai-next`;
3. conservar su volumen para diagnóstico;
4. no realizar ninguna acción sobre `chatwoot-ai` de producción.
