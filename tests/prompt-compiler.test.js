import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePromptPacket } from '../src/server/promptCompiler.js';
import { createGeminiInterpreter } from '../src/server/geminiInterpreter.js';

test('search evidence becomes a bounded prompt packet with source IDs', () => {
  const packet = compilePromptPacket({ request: { text: 'Teach me cells', knowledgeMode: 'web' }, action: { id: 'teach' },
    knowledge: { mode: 'web-grounded', sources: [{ id: 0, title: 'Cell source', url: 'https://example.org/cell' }],
      supports: [{ text: 'Cells contain nuclei.', sourceIds: [0] }], text: 'Cells contain nuclei. '.repeat(2000) } });
  assert.equal(packet.action, 'teach');
  assert.equal(packet.evidence.sources[0].id, 0);
  assert.ok(JSON.stringify(packet).length <= 4800);
  assert.ok(packet.evidence.notes.length <= 1800);
  assert.equal(packet.limits.maxModelCalls, 1);
});

test('web mode refuses to send a model or agent a prompt without web sources', () => {
  assert.throws(() => compilePromptPacket({ request: { text: 'cells', knowledgeMode: 'web' }, knowledge: { mode: 'model', sources: [] } }), /no sources/i);
});

test('web evidence is compiled before a bounded website worker receives it', async () => {
  const research = { candidates: [{ content: { parts: [{ text: 'Use a simple portfolio structure.' }] },
    groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org/portfolio', title: 'Portfolio reference' } }],
      groundingSupports: [{ segment: { text: 'A portfolio includes projects.' }, groundingChunkIndices: [0] }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
  let calls = 0; let received = null;
  const interpret = createGeminiInterpreter({ apiKey: 'test', fetchImpl: async (url, options) => { calls++; assert.deepEqual(JSON.parse(options.body).tools, [{ google_search: {} }]);
    return { ok: true, status: 200, json: async () => research }; },
  executeWebsite: async ({ prompt }) => { received = JSON.parse(prompt); return { status: 'completed', output: { html: '<html><body>Portfolio</body></html>', buildPlan: [] }, telemetry: [{ inputTokensActual: 20, outputTokens: 10, estimatedCost: 0.001 }] }; } });
  const semantic = await interpret({ text: 'Build my portfolio website', knowledgeMode: 'web' });
  assert.equal(calls, 1);
  assert.equal(received.evidence.sources[0].id, 0);
  assert.equal(semantic.context.modelUsage.calls, 2);
  assert.equal(semantic.context.modelUsage.inputTokens, 30);
});
