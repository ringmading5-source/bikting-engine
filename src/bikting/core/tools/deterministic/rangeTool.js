export const rangeTool = {
  id: 'data.range-generator', name: 'Numeric range generator', domain: 'data',
  capabilities: [{ id: 'data.generate_range', operation: 'generate_values', acceptedInputs: ['start', 'end', 'step'], producedOutputs: ['numeric_data'], executionMode: 'deterministic', computational: true }],
  operations: ['generate_values'], deterministic: true,
  async execute({ start, end, step = 1 }) {
    const first = Number(start); const last = Number(end); const increment = Number(step);
    if (![first, last, increment].every(Number.isFinite) || increment === 0 || (last - first) * increment < 0) throw new RangeError('Range inputs must be finite and step must move toward end.');
    const count = Math.floor((last - first) / increment + 1e-10) + 1;
    if (count < 1 || count > 1001) throw new RangeError('Range generation is limited to 1001 values.');
    return { type: 'numeric_series', values: Array.from({ length: count }, (_, index) => Number((first + increment * index).toPrecision(12))), deterministic: true };
  },
};
