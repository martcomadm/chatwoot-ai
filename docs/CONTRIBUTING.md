# MARTCOM AI — Contributing Guide

## Regla principal
Ninguna función entra a producción si no puede observarse, medirse y explicarse desde el Inspector.

## Flujo
```text
Problema
  ↓
RFC / Diseño
  ↓
feature/*
  ↓
Implementación
  ↓
Tests
  ↓
Staging
  ↓
Producción
  ↓
Observación
  ↓
Retrospectiva
```

## Ramas
- `main`: producción.
- `develop`: integración.
- `feature/*`: nuevas funciones.
- `fix/*`: correcciones.
- `hotfix/*`: incidencias críticas.

## Commits
Ejemplos:
- `feat(semantic): add employment normalization`
- `fix(memory): reject conversational phrases as names`
- `test(conflicts): add unemployment regression case`
- `docs(rfc): define semantic engine v3.1.2`

## Reglas por módulo
- Core: sin lógica comercial.
- Intent: solo clasificar intención.
- Semantic: significado, slots y conflictos.
- Memory: no decide preguntas.
- Planner: no redacta texto final.
- AI: no decide intención ni fase.
- Quality: no modifica memoria comercial.
- Inspector: solo lectura.

## Tests
Cada bug de producción se convierte en test.
Antes de deploy:
```bash
npm test
node --check src/server.js
```

## Variables de entorno
Toda variable nueva:
- va en `.env.example`;
- se documenta;
- no expone secretos en repositorio.

## Observabilidad
Toda capacidad nueva debe generar eventos auditables.

## Rollback
Antes de deploy:
- conservar release previo;
- no borrar `/app/data`;
- no romper el formato persistente sin migración compatible;
- documentar retorno a la versión anterior.

## Filosofía conversacional
MARTCOM AI debe:
- escuchar antes de preguntar;
- recordar sin recitar;
- responder antes de interrogar cuando corresponde;
- evitar repeticiones;
- vender confianza y acompañamiento;
- transferir de forma orgánica.

La experiencia del cliente tiene prioridad sobre recolectar más datos.
