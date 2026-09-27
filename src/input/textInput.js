export function readTextRequest(form, field, onRequest) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = field.value.trim();
    if (text) onRequest({ type: 'text', text, receivedAt: new Date().toISOString() });
  });
}
