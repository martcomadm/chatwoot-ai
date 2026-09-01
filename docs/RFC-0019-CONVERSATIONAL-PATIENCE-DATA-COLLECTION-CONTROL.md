# RFC-0019 — Core V3.3.3 Conversational Patience & Data Collection Control

## Objetivo
Evitar que CURP/NSS se conviertan en el destino obligatorio del flujo.

## Estados persistentes
- unknown
- promised_later
- searching
- unavailable
- declined
- received

## Reglas duras
1. Si el cliente promete el dato después, no se vuelve a pedir.
2. Si está buscando el dato, se espera.
3. Si no lo tiene, se continúa sin presionarlo.
4. Una pregunta directa del cliente se responde antes de recopilar datos.
5. Una pregunta directa nunca encadena inmediatamente una petición de CURP/NSS.
6. Frases de presión como "ya te dije", "no insistas" o "mala impresión" suprimen solicitudes sensibles.
7. CURP/NSS dejan de ser fallback universal.
8. "Sería con..." no puede convertirse en nombre.

## Compatibilidad
No modifica Advisor Affinity, handoff router, rotaciones ni Inspector V1.6.
Los nuevos campos se integran por deep merge con memorias existentes.
