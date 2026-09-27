import { createModelAdapter } from './ModelAdapter.js';

export const mockModels = [
  createModelAdapter({ id: 'mock.text', name: 'Mock text model', domain: 'language', modalities: ['text'], capabilities: ['text.generate'], metadata: { adapter: 'mock', provider: null }, methods: { async generate(semantic) { return { type: 'explanation', text: `Prepared an explanation for ${semantic.concepts.join(', ') || semantic.intent}.` }; } } }),
  createModelAdapter({ id: 'mock.voice', name: 'Mock voice model', domain: 'voice', modalities: ['voice'], capabilities: ['voice.synthesize'], metadata: { adapter: 'mock', provider: null }, methods: { async synthesize(semantic) { return { type: 'narration', mode: 'synchronized_segments', segments: semantic.relationships.map(({ from, relation, to }) => `${from} ${relation} ${to}`) }; } } }),
  createModelAdapter({ id: 'mock.vision', name: 'Mock vision model', domain: 'vision', modalities: ['vision'], capabilities: ['vision.interpret'], metadata: { adapter: 'mock', provider: null }, methods: { async interpret(semantic) { return { type: 'vision_result', concepts: semantic.concepts, status: 'planned' }; } } }),
];
