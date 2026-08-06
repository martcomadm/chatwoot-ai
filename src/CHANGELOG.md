# CHANGELOG

## 3.0.1.2

### Corregido
- Se agrega `MemoryStore.list()` al paquete de actualización.
- El endpoint `/inspector/api/conversations` incluye respaldo compatible si `list()` no existe.
- El Inspector ya no genera `TypeError: memories.list is not a function`.
- Se mantiene la corrección de firmas de la V3.0.1.1.


## 3.0.1.1

### Corregido
- Se evita que el nombre del asesor aparezca como firma al final de cada respuesta.
- Se agregó detección en el control de calidad.
- Se agregó limpieza automática antes de enviar el mensaje.
- El nombre se conserva en la primera presentación y en la memoria de la conversación.
