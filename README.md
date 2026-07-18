# MARTCOM Chatwoot AI

Servicio Node.js para que el usuario **AXEL IA** atienda conversaciones de Chatwoot cuando le sean asignadas.

## Datos configurados

- Chatwoot: `https://martcomchats-chatwoot.mchc0z.easypanel.host`
- Cuenta: `1`
- Inbox Martcom: `6`
- Usuario AXEL IA: `12`
- Horario: `07:00–22:00`, `America/Mexico_City`

## Primera versión

- Se activa cuando la conversación está asignada a AXEL IA.
- Agrega `asignado`.
- Retira `sin_atender`.
- Conserva las etiquetas existentes.
- Responde mensajes entrantes.
- Clasifica usando únicamente las etiquetas actuales de MARTCOM.
- Usa `validacion` y una nota privada cuando se necesita intervención humana.
- Se detiene si otro agente toma el chat.
- No cierra conversaciones automáticamente.
- No marca `no_contesta` automáticamente.
- No ejecuta todavía seguimientos por temporizador.

## Despliegue en EasyPanel

1. Sube estos archivos a un repositorio privado de GitHub.
2. En el proyecto actual de EasyPanel crea un servicio de aplicación llamado `chatwoot-ai`.
3. Selecciona GitHub como fuente y conecta el repositorio.
4. EasyPanel detectará el `Dockerfile`.
5. Configura el puerto interno `3000`.
6. Agrega un dominio público para el servicio.
7. Copia las variables de `.env.example` al apartado Environment.
8. Sustituye:
   - `CHATWOOT_ACCESS_TOKEN`
   - `OPENAI_API_KEY`
   - `WEBHOOK_SECRET`
9. Despliega y abre `/health`.

## Webhook de Chatwoot

En Chatwoot:

`Configuración → Integraciones → Webhooks → Agregar webhook`

URL:

`https://DOMINIO-DEL-BOT/webhook/chatwoot?secret=TU_WEBHOOK_SECRET`

Eventos:

- `message_created`
- `conversation_updated`

## Prueba

1. Abre una conversación real de prueba en el inbox Martcom.
2. Asígnala a AXEL IA.
3. Confirma que aparezca `asignado` y desaparezca `sin_atender`.
4. Envía un mensaje desde el WhatsApp del cliente.
5. Revisa los logs del servicio.
6. Reasigna el chat a un humano y envía otro mensaje; AXEL IA ya no debe responder.

## Seguridad

Nunca subas `.env` a GitHub. Usa un repositorio privado y guarda los tokens únicamente en EasyPanel.
