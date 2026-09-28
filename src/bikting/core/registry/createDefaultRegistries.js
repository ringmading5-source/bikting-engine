import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ModelRegistry } from '../models/ModelRegistry.js';
import { placeholderTools } from '../tools/adapters/placeholderTools.js';
import { mockModels } from '../models/adapters/mockModels.js';
import { calculatorTool, equationEvaluatorTool } from '../tools/deterministic/mathTools.js';
import { statisticsTool } from '../tools/deterministic/statisticsTool.js';
import { unitConversionTool } from '../tools/deterministic/unitConversionTool.js';
import { physicsCalculatorTool } from '../tools/deterministic/physicsTool.js';
import { rangeTool } from '../tools/deterministic/rangeTool.js';
import { structuredVisualizationTool } from '../tools/deterministic/visualizationTool.js';
import { vectorTool } from '../tools/deterministic/vectorTool.js';
import { websiteTool } from '../tools/deterministic/websiteTool.js';

export function createDefaultRegistries() {
  const tools = new ToolRegistry();
  const models = new ModelRegistry();
  [calculatorTool, equationEvaluatorTool, statisticsTool, unitConversionTool, physicsCalculatorTool, rangeTool, vectorTool, structuredVisualizationTool, websiteTool].forEach((tool) => tools.register(tool));
  placeholderTools.forEach((tool) => tools.register(tool));
  mockModels.forEach((model) => models.register(model));
  return { tools, models, catalog: [...tools.capabilityCatalog(), ...models.capabilityCatalog()] };
}
