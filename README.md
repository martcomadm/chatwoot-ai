# MARTCOM Chatwoot AI V2.5.5

## Transición orgánica al asesor humano

Esta versión conserva todas las funciones de la V2.5.4 y mejora el momento en que se recibe CURP, NSS, archivos, documentos, comprobantes o una solicitud de atención humana.

### Nuevo comportamiento

AXEL IA ya no dirá:

- “Un asesor revisará personalmente su caso.”
- “En unos momentos continuará la atención.”
- “Será transferido con un asesor.”
- “Otro asesor tomará su caso.”

En su lugar responderá:

`Gracias, ya tengo la información necesaria. Voy a revisar tu caso para darte la orientación adecuada.`

La conversación mantiene el nombre de presentación asignado —Susana Solis, Carlos Ruiz o Jozic Martinez— para que el asesor real pueda continuar sin que el cliente perciba un cambio brusco.

Después de enviar ese mensaje, la automatización deja de responder en la conversación y genera el resumen privado para el equipo.

## Funciones conservadas

- Rotación persistente de nombres.
- Buffer de mensajes.
- Memoria persistente.
- Motor comercial y Plan 2.
- Respaldo ante errores Chatwoot 403.
- Reformulación de preguntas pendientes.
- Fallback de calidad obligatorio.

## Implementación

Reemplaza los archivos del repositorio y vuelve a implementar en EasyPanel. No necesitas cambiar variables de entorno.

El log correcto debe mostrar:

`AXEL IA V2.5.5 escuchando en puerto 3000`
