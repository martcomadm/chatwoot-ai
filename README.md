MARTCOM Chatwoot AI V2.3
Esta versión agrega memoria estructurada por conversación antes de cada respuesta.
Mejoras:
No repite preguntas ya contestadas.
Recuerda edad, actividad, IMSS actual y necesidades.
Detecta contradicciones.
Distingue CURP y NSS del nombre.
Mejora el resumen privado.
Maneja correctamente preguntas sobre cambio de AFORE.
Procesa el último mensaje al asignar el chat.
Actualiza en GitHub:
src/server.js
src/knowledge.js
package.json
Después vuelve a implementar en EasyPanel.
Log esperado:
AXEL IA V2.3 escuchando en puerto 3000
Nota: usa dos llamadas de OpenAI por mensaje: una para extraer la ficha y otra para responder.
