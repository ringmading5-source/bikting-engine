export const vectorTool = {
  id: 'math.vectors', name: 'Vector calculations', domain: 'mathematics',
  capabilities: [{ id: 'vector.calculate', operation: 'calculate_vector', acceptedInputs: ['operation', 'vectorA', 'vectorB'], producedOutputs: ['numeric_result'], executionMode: 'deterministic', computational: true }],
  operations: ['calculate_vector'], deterministic: true,
  async execute({ operation, vectorA, vectorB }) {
    if (!Array.isArray(vectorA) || vectorA.length < 2 || vectorA.length > 16 || !vectorA.every(Number.isFinite)) throw new TypeError('vectorA needs 2–16 finite numbers.');
    if (operation === 'magnitude') return { type: 'numeric_result', numericResult: Math.hypot(...vectorA), deterministic: true };
    if (operation !== 'dot_product' || !Array.isArray(vectorB) || vectorB.length !== vectorA.length || !vectorB.every(Number.isFinite)) throw new TypeError('Dot product needs two equal-length numeric vectors.');
    return { type: 'numeric_result', numericResult: vectorA.reduce((sum, item, index) => sum + item * vectorB[index], 0), deterministic: true };
  },
};
