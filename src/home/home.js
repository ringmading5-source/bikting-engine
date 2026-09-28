const KEY = 'bikting.home.v1';
export function setupHome({ onResume, onNew, onOpen, onPreferences }) {
  const panel = document.getElementById('home-panel');
  const toggle = document.getElementById('home-toggle');
  let state = { projects: [], preferences: { language: 'en-US', rate: 0.95 } };
  let storageWarning = '';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Array.isArray(saved.projects)) state = { projects: saved.projects.filter(p => p && typeof p.text === 'string').slice(0, 20), preferences: { ...state.preferences, ...saved.preferences } };
  } catch { storageWarning = 'Saved data could not be loaded. New work remains available during this session.'; }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageWarning = ''; }
    catch { storageWarning = 'Browser storage is full or unavailable. This work is only saved for this session.'; }
  };
  const close = () => { panel.close(); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); };
  panel.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  document.getElementById('close-home').onclick = close;
  toggle.onclick = () => { onOpen(); render(); panel.showModal(); toggle.setAttribute('aria-expanded', 'true'); loadTools(); };
  document.getElementById('new-project').onclick = () => { close(); onNew(); };
  const language = document.getElementById('voice-language');
  const rate = document.getElementById('voice-rate');
  language.value = state.preferences.language;
  rate.value = state.preferences.rate;
  const preferences = () => { state.preferences = { language: language.value, rate: Number(rate.value) }; save(); onPreferences(state.preferences); };
  language.onchange = preferences;
  rate.onchange = preferences;
  onPreferences(state.preferences);
  function render() {
    document.getElementById('storage-note').textContent = storageWarning || 'Saved in this browser on this device. These projects do not sync to an account.';
    const projects = document.getElementById('saved-projects');
    const creations = document.getElementById('saved-creations');
    projects.replaceChildren(); creations.replaceChildren();
    for (const project of state.projects) {
      const row = document.createElement('article'); row.className = 'home-project';
      const title = document.createElement('strong'); title.textContent = project.text;
      const info = document.createElement('p'); info.textContent = `${project.result?.workspace?.status || 'Draft'} · ${new Date(project.updatedAt).toLocaleString()}`;
      const resume = document.createElement('button'); resume.textContent = project.result ? 'Open result' : 'Resume draft';
      resume.onclick = () => { close(); onResume(project); };
      row.append(title, info, resume); projects.append(row);
      if (project.result) {
        const button = document.createElement('button'); button.textContent = project.result.workspace?.title || project.text;
        button.onclick = () => { close(); onResume(project); }; creations.append(button);
      }
    }
    if (!projects.children.length) projects.textContent = 'No projects yet. Start with a question or an idea.';
    if (!creations.children.length) creations.textContent = 'Your saved results will appear here after a run.';
    const usage = state.projects.reduce((sum, p) => { const u = p.result?.usage; sum.calls += u?.modelCalls || 0; sum.tokens += (u?.inputTokens || 0) + (u?.outputTokens || 0); return sum; }, { calls: 0, tokens: 0 });
    document.getElementById('home-usage').textContent = `${usage.calls} model calls · ${usage.tokens} reported tokens across retained results. Account balance, lifetime usage, and billing are not connected.`;
  }
  async function loadTools() {
    const target = document.getElementById('home-tools'); target.textContent = 'Checking available tools…';
    try {
      const [health, capabilities] = await Promise.all([fetch('/health'), fetch('/api/capabilities')]);
      if (!health.ok || !capabilities.ok) throw new Error();
      const [status, tools] = await Promise.all([health.json(), capabilities.json()]);
      target.replaceChildren();
      const description = document.createElement('p'); description.textContent = `Interpreter: ${status.interpreter === 'gemini' ? 'Gemini configured on server' : 'Local mock interpreter'}. External account sign-in is not implemented.`; target.append(description);
      const list = document.createElement('ul');
      for (const tool of tools) { const item = document.createElement('li'); item.textContent = `${tool.id} · ${tool.domain}`; list.append(item); }
      target.append(list);
    } catch { target.textContent = 'Could not load tool status. Check that the Bikting server is running.'; }
  }
  return {
    record(request, result = null, id = crypto.randomUUID()) {
      const project = { id, text: request.text, knowledgeMode: request.knowledgeMode, sketch: request.sketch, sketchLayout: request.sketchLayout, result: result ? { workspace: result.workspace, trace: result.trace, usage: result.usage } : null, updatedAt: new Date().toISOString() };
      state.projects = [project, ...state.projects.filter(p => p.id !== id)].slice(0, 20); save(); return id;
    }
  };
}
