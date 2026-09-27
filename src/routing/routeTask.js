export function routeTask(plan, interpretation, registry) {
  const module = registry.select(interpretation);
  if (!module) throw new Error(`No module can handle ${interpretation.intent}`);
  return { module, result: module.execute({ interpretation, plan }) };
}
