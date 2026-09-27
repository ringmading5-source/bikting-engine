import { evaluateExpression } from '../../execution/SafeExpression.js';

export const physicsCalculatorTool = {
  id: 'physics.calculator', name: 'Structured physics calculator', domain: 'physics',
  capabilities: [
    { id: 'physics.calculate_force', aliases: ['calculate_force'], operation: 'calculate_force', acceptedInputs: ['variables.mass', 'variables.acceleration'], producedOutputs: ['equation', 'numeric_result', 'unit'], executionMode: 'deterministic', computational: true },
    { id: 'physics.calculate_force_series', operation: 'calculate_force_series', acceptedInputs: ['masses', 'acceleration'], producedOutputs: ['numeric_data', 'unit'], executionMode: 'deterministic', computational: true, visual: true },
  ],
  operations: ['calculate_force', 'calculate_force_series'], deterministic: true,
  async execute(input) {
    if (input.operation === 'calculate_force_series' || Array.isArray(input.masses)) {
      const masses = finiteArray(input.masses, 'masses'); const acceleration = finiteNumber(input.acceleration, 'acceleration');
      return { type: 'physics_series', equation: 'F = m * a', values: masses.map((mass) => evaluateExpression('mass * acceleration', { mass, acceleration })), masses, acceleration, unit: 'N', deterministic: true };
    }
    const variables = input.variables ?? input;
    const mass = finiteNumber(variables.mass ?? variables.m, 'mass'); const acceleration = finiteNumber(variables.acceleration ?? variables.a, 'acceleration');
    return { type: 'physics_result', equation: 'F = m * a', numericResult: evaluateExpression('m * a', { m: mass, a: acceleration }), variables: { mass, acceleration }, unit: 'N', deterministic: true };
  },
};

function finiteNumber(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number.`); return number; }
function finiteArray(values, name) { if (!Array.isArray(values) || values.some((value) => !Number.isFinite(Number(value)))) throw new TypeError(`${name} must be an array of finite numbers.`); return values.map(Number); }
