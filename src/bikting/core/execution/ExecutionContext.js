export function createExecutionContext({ request, semanticObject, plan, requestId = semanticObject.id }) {
  return {
    requestId,
    semanticObject,
    plan,
    variables: { ...semanticObject.variables },
    intermediateResults: {},
    toolResults: [],
    modelResults: [],
    metadata: { requestSource: semanticObject.source, startedAt: new Date().toISOString(), requestText: request.text },
  };
}

export function resolveInputMapping(mapping, context) {
  if (!mapping) return { ...context.variables, semantic: context.semanticObject };
  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, resolveReference(value, context)]));
}

function resolveReference(reference, context) {
  if (typeof reference !== 'string' || !reference.startsWith('$')) return reference;
  const path = reference.slice(1).split('.');
  let value = { semantic: context.semanticObject, variables: context.variables, results: context.intermediateResults };
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (value == null) throw new Error(`Unresolved execution input: ${reference}`);
    value = value[segment];
    if (value === undefined && index < path.length - 1) throw new Error(`Unresolved execution input: ${reference}`);
  }
  return value;
}
