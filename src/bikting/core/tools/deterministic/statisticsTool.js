export const statisticsTool = {
  id: 'statistics.basic', name: 'Deterministic statistics', domain: 'statistics',
  capabilities: [{ id: 'statistics.analyze', aliases: ['mean', 'median', 'min', 'max', 'variance', 'standard_deviation', 'correlation'], operation: 'analyze', acceptedInputs: ['data', 'statistic', 'otherData'], producedOutputs: ['numeric_result', 'statistical_analysis'], executionMode: 'deterministic', computational: true }],
  operations: ['mean', 'median', 'min', 'max', 'variance', 'standard_deviation', 'correlation'], deterministic: true,
  async execute({ data, statistic = 'mean', otherData }) {
    const values = finiteArray(data, 'data');
    const mean = average(values);
    let numericResult;
    switch (statistic) {
      case 'mean': numericResult = mean; break;
      case 'median': { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); numericResult = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; break; }
      case 'min': numericResult = Math.min(...values); break;
      case 'max': numericResult = Math.max(...values); break;
      case 'variance': numericResult = average(values.map((value) => (value - mean) ** 2)); break;
      case 'standard_deviation': numericResult = Math.sqrt(average(values.map((value) => (value - mean) ** 2))); break;
      case 'correlation': numericResult = correlation(values, finiteArray(otherData, 'otherData')); break;
      default: throw new RangeError(`Unsupported statistic: ${statistic}`);
    }
    return { type: 'statistical_result', statistic, numericResult, numericData: { data: values }, deterministic: true };
  },
};

function finiteArray(values, name) { if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(Number(value)))) throw new TypeError(`${name} must be a non-empty array of finite numbers.`); return values.map(Number); }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) throw new RangeError('Correlation requires equal arrays with at least two values.');
  const meanLeft = average(left); const meanRight = average(right);
  const covariance = left.reduce((sum, value, index) => sum + (value - meanLeft) * (right[index] - meanRight), 0);
  const denominator = Math.sqrt(left.reduce((sum, value) => sum + (value - meanLeft) ** 2, 0) * right.reduce((sum, value) => sum + (value - meanRight) ** 2, 0));
  if (!denominator) throw new RangeError('Correlation is undefined for a constant data series.');
  return covariance / denominator;
}
