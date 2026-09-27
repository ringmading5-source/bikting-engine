const units = {
  m: { dimension: 'length', factor: 1, label: 'm' }, meter: { dimension: 'length', factor: 1, label: 'm' }, meters: { dimension: 'length', factor: 1, label: 'm' },
  km: { dimension: 'length', factor: 1000, label: 'km' }, cm: { dimension: 'length', factor: 0.01, label: 'cm' }, mm: { dimension: 'length', factor: 0.001, label: 'mm' },
  s: { dimension: 'time', factor: 1, label: 's' }, sec: { dimension: 'time', factor: 1, label: 's' }, seconds: { dimension: 'time', factor: 1, label: 's' },
  min: { dimension: 'time', factor: 60, label: 'min' }, minute: { dimension: 'time', factor: 60, label: 'min' }, minutes: { dimension: 'time', factor: 60, label: 'min' },
  h: { dimension: 'time', factor: 3600, label: 'h' }, hr: { dimension: 'time', factor: 3600, label: 'h' }, hour: { dimension: 'time', factor: 3600, label: 'h' }, hours: { dimension: 'time', factor: 3600, label: 'h' },
  kg: { dimension: 'mass', factor: 1, label: 'kg' }, g: { dimension: 'mass', factor: 0.001, label: 'g' },
};

export const unitConversionTool = {
  id: 'units.converter', name: 'Unit converter', domain: 'mathematics',
  capabilities: [{ id: 'units.convert', operation: 'convert', acceptedInputs: ['value', 'fromUnit', 'toUnit'], producedOutputs: ['numeric_result', 'unit'], executionMode: 'deterministic', computational: true }],
  operations: ['convert'], deterministic: true,
  async execute({ value, fromUnit, toUnit }) {
    const from = units[String(fromUnit ?? '').toLowerCase()]; const to = units[String(toUnit ?? '').toLowerCase()];
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError('Unit conversion value must be a finite number.');
    if (!from || !to) throw new RangeError('Unsupported unit.');
    if (from.dimension !== to.dimension) throw new RangeError(`Incompatible units: ${from.dimension} and ${to.dimension}.`);
    const numericResult = number * from.factor / to.factor;
    return { type: 'unit_conversion', numericResult, from: { value: number, unit: from.label }, to: { value: numericResult, unit: to.label }, deterministic: true };
  },
};
