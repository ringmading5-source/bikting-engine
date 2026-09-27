import { evaluateExpression } from '../../execution/SafeExpression.js';

export const calculatorTool = {
  id: 'math.calculator', name: 'Safe mathematics calculator', domain: 'mathematics',
  capabilities: [{ id: 'math.calculate', aliases: ['calculate', 'plot_series'], domain: 'mathematics', operation: 'calculate', acceptedInputs: ['expression', 'variables', 'xValues', 'yValues'], producedOutputs: ['numeric_result', 'equation', 'graph'], executionMode: 'deterministic', visual: true, computational: true }],
  operations: ['calculate', 'evaluate_equation', 'plot_equation', 'plot_series'], inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { numericResult: { type: 'number' }, structuredVisualScenes: { type: 'object' } } }, deterministic: true, executionMode: 'deterministic',
  async execute(input) {
    if (input.operation === 'plot_series') {
      if (!Array.isArray(input.xValues) || !Array.isArray(input.yValues) || input.xValues.length !== input.yValues.length) throw new TypeError('Plot series needs equally sized xValues and yValues arrays.');
      const points = input.xValues.map((x, index) => ({ x, y: input.yValues[index] }));
      return { type: 'graph_data', structuredVisualScenes: graphScene(input.expression ?? 'data series', points), numericData: points, deterministic: true };
    }
    if (input.operation === 'plot_equation' || /^\s*[a-z_]\w*\s*=/.test(input.expression ?? '')) {
      const { variable, expression } = splitEquation(input.expression);
      const xMin = Number(input.xMin ?? -10); const xMax = Number(input.xMax ?? 10); const sampleCount = safeSampleCount(input.sampleCount ?? 41);
      const points = Array.from({ length: sampleCount }, (_, index) => {
        const x = xMin + (xMax - xMin) * index / (sampleCount - 1);
        return { x, y: evaluateExpression(expression, { ...(input.variables ?? {}), [variable]: x, x }) };
      });
      return { type: 'graph_data', equation: input.expression, structuredVisualScenes: graphScene(input.expression, points), numericData: points, deterministic: true };
    }
    if (!input.expression) return { status: 'planned', type: 'mathematical_representation', message: 'A numeric expression was not part of the semantic input.', deterministic: true };
    const numericResult = evaluateExpression(input.expression, input.variables ?? {});
    return { type: 'numeric_result', numericResult, equation: input.expression, text: String(numericResult), deterministic: true };
  },
};

export const equationEvaluatorTool = {
  id: 'math.equation-evaluator', name: 'Equation evaluator', domain: 'mathematics',
  capabilities: [{ id: 'math.evaluate_equation', operation: 'evaluate_equation', acceptedInputs: ['equation', 'variables'], producedOutputs: ['equation', 'numeric_result'], executionMode: 'deterministic', computational: true }],
  operations: ['evaluate_equation'], deterministic: true,
  async execute({ equation, variables = {} }) {
    const { variable, expression } = splitEquation(equation);
    return { type: 'equation_result', equation, variable, numericResult: evaluateExpression(expression, variables), deterministic: true };
  },
};

export function splitEquation(equation) {
  const match = /^\s*([a-z_]\w*)\s*=\s*(.+?)\s*$/i.exec(String(equation ?? ''));
  if (!match) throw new TypeError('Equation must have the form variable = expression.');
  return { variable: match[1], expression: match[2] };
}

export function graphScene(expression, points) {
  return { type: 'graph', axes: { x: { label: 'x', scale: 'linear' }, y: { label: 'y', scale: 'linear' } }, series: [{ expression, points }], deterministic: true };
}

function safeSampleCount(value) { const count = Math.trunc(Number(value)); if (!Number.isInteger(count) || count < 2 || count > 1001) throw new RangeError('sampleCount must be between 2 and 1001.'); return count; }
