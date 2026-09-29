import { validateGeneratedWebsite } from '../../../../server/buildPrompt.js';

const colors = { blue: '#2563eb', green: '#15803d', red: '#dc2626', purple: '#7c3aed', orange: '#ea580c', pink: '#db2777', black: '#111827', yellow: '#ca8a04', teal: '#0d9488' };

/** Revise the existing safe preview without rebuilding or publishing it. */
export const websiteEditTool = {
  id: 'website.color-editor', name: 'Website color editor', domain: 'web', deterministic: true,
  capabilities: [{ id: 'website.edit', operation: 'edit_website', acceptedInputs: ['html', 'instruction'], producedOutputs: ['website'], executionMode: 'deterministic', visual: true }],
  inputRequirements: ['html', 'instruction'],
  async execute({ html, instruction, title }) {
    validateGeneratedWebsite(html);
    const colorName = Object.keys(colors).find((name) => new RegExp(`\\b${name}\\b`, 'i').test(instruction));
    const hex = /#[0-9a-fA-F]{6}\b/.exec(instruction)?.[0];
    const accent = hex ?? colors[colorName];
    if (!accent) return { status: 'blocked', reason: 'Name a color or six-digit hex value for this edit.' };
    const style = `<style data-bikting-edit="color">header,footer,.hero{background:${accent}!important}.hero,.hero h1,footer{color:#fff!important}header strong,main h2,nav a{color:${accent}!important}.button{background:#fff!important;color:${accent}!important}</style>`;
    const updated = validateGeneratedWebsite(html.replace(/<\/head>/i, `${style}</head>`));
    return { type: 'website', html: updated, structuredVisualScenes: { type: 'website', html: updated, title: title || 'Website', mode: 'edited',
      states: [{ title: 'Requested change', text: `Change website colors to ${colorName ?? accent}.` }, { title: 'Updated preview', text: 'The website preview now shows the revised colors.' }],
      source: { type: 'tool', id: this.id, deterministic: true } } };
  },
};
