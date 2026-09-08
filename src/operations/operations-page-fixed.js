import { operationsPage as baseOperationsPage } from "./operations-page.js";

export function operationsPage() {
  const base = baseOperationsPage();
  const fixedButton = base.replace(
    'onclick="resetLabConversation()"',
    'onclick="window.resetLabConversationSafe()"'
  );

  const script = `<script>
window.resetLabConversationSafe = async function () {
  const input = document.getElementById('resetConversationId');
  const resultEl = document.getElementById('resetResult');
  const button = document.getElementById('resetConversationBtn');
  if (!input || !resultEl || !button) {
    alert('No se pudo inicializar el control de reinicio. Recarga la página.');
    return;
  }

  const setStatus = (message, kind) => {
    resultEl.className = 'lab-result' + (kind ? ' ' + kind : '');
    resultEl.textContent = message;
  };

  const id = Number(input.value);
  if (!Number.isInteger(id) || id <= 0) {
    setStatus('Ingresa un Conversation ID válido.', 'errmsg');
    return;
  }

  setStatus('Esperando confirmación…', '');
  const confirmation = window.prompt(
    'Esta acción borrará la memoria NEXT y los expedientes LAB del chat ' + id +
    '. Para confirmar escribe exactamente: RESET ' + id
  );
  if (confirmation !== 'RESET ' + id) {
    setStatus('Reset cancelado: confirmación incorrecta.', 'errmsg');
    return;
  }
  if (!window.confirm('Última confirmación: ¿reiniciar la conversación LAB ' + id + '?')) {
    setStatus('Reset cancelado.', '');
    return;
  }

  button.disabled = true;
  button.textContent = 'Reiniciando…';
  setStatus('Reiniciando conversación ' + id + '…', '');

  try {
    const params = new URLSearchParams(window.location.search);
    const opsToken = params.get('token') || window.localStorage.getItem('nextOpsToken') || '';
    const response = await window.fetch('/operations/api/lab/reset-conversation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operations-token': opsToken,
      },
      body: JSON.stringify({ conversation_id: id, confirm: 'RESET ' + id }),
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload.error || 'Error HTTP ' + response.status);

    const removed = Array.isArray(payload.removed_sale_ids) ? payload.removed_sale_ids : [];
    setStatus(
      'Conversación ' + id + ' reiniciada. Memoria limpia. Expedientes eliminados: ' +
      (removed.length ? removed.join(', ') : 'ninguno') + '.',
      'okmsg'
    );
    input.value = '';
    window.setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    setStatus('No se pudo reiniciar: ' + (error?.message || String(error)), 'errmsg');
  } finally {
    button.disabled = false;
    button.textContent = 'Reiniciar prueba';
  }
};
</script>`;

  return fixedButton.replace("</body>", script + "</body>");
}
