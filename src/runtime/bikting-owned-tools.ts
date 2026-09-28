import { CapabilityRegistry } from '../capabilities/capability.registry';
import { CapabilityProviderRegistry } from '../providers/provider.registry';
import { CanonicalProviderInvoker } from '../execution/provider-invoker';
// @ts-expect-error Existing JavaScript calculator has no declaration file.
import { calculatorTool } from '../bikting/core/tools/deterministic/mathTools.js';
import { createWebsiteScaffold } from './website-scaffold';

export interface InstalledTool {
  id: string;
  owner: 'bikting';
  capabilityId: string;
  kind: 'deterministic';
  externalAccountRequired: false;
  description: string;
}

/** First-party tools only. External web sources and mock adapters are excluded. */
export function createBiktingOwnedTools() {
  const capabilities = new CapabilityRegistry();
  const providers = new CapabilityProviderRegistry();
  const invoker = new CanonicalProviderInvoker();
  const installed: InstalledTool[] = [
    { id: 'math.calculator', owner: 'bikting', capabilityId: 'math.calculate', kind: 'deterministic', externalAccountRequired: false, description: 'Safe local arithmetic evaluator' },
    { id: 'local.website-scaffold', owner: 'bikting', capabilityId: 'code.scaffold', kind: 'deterministic', externalAccountRequired: false, description: 'Three-file personal website starter' },
  ];
  capabilities.registerCapability({ id: 'math.calculate', kind: 'capability', name: 'Local arithmetic', operations: ['calculate'], inputs: [{ name: 'expression', type: 'string', required: true }], outputs: [{ name: 'numericResult', type: 'number' }] });
  capabilities.registerCapability({ id: 'code.scaffold', kind: 'capability', name: 'Local website starter', operations: ['scaffold'], inputs: [], outputs: [{ name: 'files', type: 'workspace_files' }] });
  providers.register({ id: 'math.calculator', name: 'Bikting calculator', capabilityIds: ['math.calculate'], properties: { operations: ['calculate'], inputs: [{ name: 'expression', type: 'string' }], outputs: [{ name: 'numericResult', type: 'number' }] }, executorKind: 'deterministic', availability: 'available', metadata: { owner: 'bikting', installed: true } });
  providers.register({ id: 'local.website-scaffold', name: 'Bikting website template', capabilityIds: ['code.scaffold'], properties: { operations: ['scaffold'], inputs: [], outputs: [{ name: 'files', type: 'workspace_files' }] }, executorKind: 'deterministic', availability: 'available', metadata: { owner: 'bikting', installed: true } });
  invoker.register({ providerId: 'math.calculator', capabilityIds: ['math.calculate'], async invoke({ input }) { return calculatorTool.execute(input); } });
  invoker.register({ providerId: 'local.website-scaffold', capabilityIds: ['code.scaffold'], async invoke() { return { files: createWebsiteScaffold() }; } });
  return { capabilities, providers, invoker, installed: Object.freeze(installed.map((tool) => Object.freeze({ ...tool }))) };
}
