const methodForOperation = { interpret: 'interpret', interpret_vision: 'interpret', generate: 'generate', explain: 'generate', generate_explanation: 'generate', synthesize: 'synthesize', speak: 'synthesize', generate_voice_narration: 'synthesize', analyze: 'analyze', generate_image: 'generateImage' };

/** Provider-neutral facade for language, vision, speech, and image model adapters. */
export function createModelAdapter({ id, name, domain, modalities, capabilities, methods = {}, metadata = {} }) {
  const unavailable = (method) => async () => { throw new Error(`Model adapter ${id} does not implement ${method}().`); };
  return {
    id, name, domain, modalities: [...modalities], capabilities: [...capabilities], methods, metadata: { ...metadata },
    interpret: methods.interpret ?? unavailable('interpret'),
    generate: methods.generate ?? unavailable('generate'),
    analyze: methods.analyze ?? unavailable('analyze'),
    synthesize: methods.synthesize ?? unavailable('synthesize'),
    generateImage: methods.generateImage ?? unavailable('generateImage'),
    async execute(input, context) {
      const capability = input.capability;
      const methodName = methodForOperation[capability?.operation] ?? methodForOperation[capability?.requiredCapability?.split('.').at(-1)];
      const method = this[methodName];
      if (typeof method !== 'function') throw new Error(`Model adapter ${id} does not implement ${methodName ?? 'the required operation'}.`);
      return method(input.semantic, input, context);
    },
  };
}
