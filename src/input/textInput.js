export function readTextRequest(form, field, onRequest, sketch) {
  if (!form || !field) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = field.value.trim();
    if (text) onRequest({ type: 'text', text, sketch: sketch?.toDataURL?.('image/png') ?? null, sketchLayout: sketch?.layout?.() ?? null, receivedAt: new Date().toISOString() });
  });
}
