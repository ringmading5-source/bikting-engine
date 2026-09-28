/** Build a safe, editable single-file starter website from the structured intent. */
export const websiteTool = {
  id: 'website.starter-builder', name: 'Starter website builder', domain: 'web',
  capabilities: [{ id: 'website.build', operation: 'build_website', acceptedInputs: ['title', 'kind'], producedOutputs: ['website'], executionMode: 'deterministic', visual: true }],
  operations: ['build_website'], deterministic: true,
  async execute({ title, kind, html: generatedHtml, generationStatus, buildPlan = [] }) {
    const name = escapeHtml(String(title || 'Your Website').slice(0, 80));
    const category = kind === 'portfolio' ? 'portfolio' : kind === 'restaurant' ? 'restaurant' : 'general';
    const intro = category === 'portfolio' ? 'A place to show your work and introduce yourself.' : category === 'restaurant' ? 'A place to introduce your restaurant and share your menu.' : 'A space to introduce what you do and share your story.';
    const starterHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title>
<style>*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#182222;background:#f6f9f5}header{padding:22px max(6vw,20px);display:flex;justify-content:space-between;align-items:center;background:#fff}header strong{font-size:20px}nav a{margin-left:20px;color:#245745;text-decoration:none}.hero{padding:100px max(6vw,20px);background:linear-gradient(120deg,#153e35,#2d765c);color:white}.hero h1{font-size:clamp(38px,7vw,74px);line-height:1.1;margin:0 0 20px;max-width:780px}.hero p{max-width:620px;font-size:20px}.button{display:inline-block;padding:12px 24px;margin-top:15px;border-radius:8px;background:#d6f187;color:#193a2f;text-decoration:none;font-weight:700}main section{padding:64px max(6vw,20px);max-width:1050px;margin:auto}h2{font-size:32px}footer{padding:30px max(6vw,20px);background:#163b32;color:#fff}@media(max-width:540px){header{display:block}nav a{margin:0 18px 0 0}.hero{padding-top:70px;padding-bottom:70px}}</style></head>
<body><header><strong>${name}</strong><nav><a href="#about">About</a><a href="#contact">Contact</a></nav></header><div class="hero"><h1>Welcome to ${name}</h1><p>${intro}</p><a class="button" href="#about">Explore</a></div><main><section id="about"><h2>About</h2><p>Add your story, services, and images here.</p></section><section id="contact"><h2>Contact</h2><p>Add your contact details or booking link here.</p></section></main><footer>${name}</footer></body></html>`;
    const html = typeof generatedHtml === 'string' ? generatedHtml : starterHtml;
    const mode = generationStatus === 'generated' && generatedHtml ? 'generated' : 'starter';
    return { type: 'website', html, structuredVisualScenes: { type: 'website', html, title: String(title || 'Your Website'), mode, states: [
      { title: 'Intent sketch', text: `Build a website for ${title || 'you'}: header, main content, and contact section.` },
      ...(buildPlan.length ? [{ title: 'Resolved build directions', text: buildPlan.join(' ') }] : []),
      { title: 'Website preview', text: mode === 'generated' ? 'Generated website ready to preview and download.' : generationStatus === 'starter_fallback' ? 'Starter website ready. Custom generation was unavailable.' : 'Starter website ready to preview and download.' }
    ], toolSelection: { selected: { id: this.id, name: this.name, status: 'available' } }, source: { type: 'tool', id: this.id, deterministic: mode !== 'generated' } }, deterministic: mode !== 'generated' };
  },
};

function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
