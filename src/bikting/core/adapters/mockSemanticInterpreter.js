import { resolveActionRequest } from './requestIntent.js';
import { resolveRelationalAction } from '../intent/actionRegistry.js';

const motorRelationships = [
  ['electrical_energy', 'flows_to', 'current'], ['current', 'produces', 'magnetic_field'], ['magnetic_field', 'causes', 'force'],
  ['force', 'produces', 'torque'], ['torque', 'causes', 'rotation'], ['rotation', 'transforms_into', 'mechanical_motion'],
];

/** Lightweight mock intent mapper. Domain tools receive the structured fields it returns, never the request sentence. */
export async function mockSemanticInterpreter(request) {
  const text = request.text ?? '';
  const lower = text.toLowerCase();
  let intent = 'unknown'; let domain = 'general'; let modality = request.modality ?? 'text';
  let concepts = []; let relationships = []; let requestedOutputs = []; let labels = [];
  let variables = {}; let equations = [];
  const task = resolveActionRequest(text);
  const relationalAction = resolveRelationalAction(text);

  const forceRange = /\bplot\s+force\b/i.test(text);
  const mass = /\bmass\s*(?:is|=|of)?\s*([\d.]+)\s*kg\b/i.exec(text);
  const acceleration = /\bacceleration\s*(?:is|=|of)?\s*([\d.]+)\s*m\s*\/\s*s(?:\^?2|²)/i.exec(text);
  if (/\b(dot product|magnitude)\b/i.test(text) && /\[[^\]]+\]/.test(text)) {
    intent = 'vector_calculate'; domain = 'mathematics'; concepts = ['vector']; requestedOutputs = ['numeric_result'];
    const lists = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].split(',').map((item) => Number(item.trim())));
    variables = { vectorOperation: /dot product/i.test(text) ? 'dot_product' : 'magnitude', vectorA: lists[0], vectorB: lists[1] };
  } else if (task) {
    intent = `${task.action}_${task.target}`; domain = task.target === 'website' ? 'web' : 'general';
    requestedOutputs = task.action === 'build' && task.target === 'website' ? ['website'] : [];
    concepts = [task.target]; labels = [task.action, task.target];
    relationships = [{ from: task.action, relation: task.action === 'build' ? 'produces' : 'requires', to: task.target, origin: 'explicit' }];
    variables = { siteTitle: task.title, siteKind: task.kind };
  } else if (forceRange) {
    intent = 'plot'; domain = 'physics'; concepts = ['force', 'mass', 'acceleration'];
    requestedOutputs = ['graph', 'numeric_data', 'structured_scene'];
    const bounds = /mass\s+(?:ranges|varies|changes)\s+from\s+([\d.]+)\s+to\s+([\d.]+)/i.exec(text);
    const rangeMass = /mass\s+from\s+([\d.]+)\s+to\s+([\d.]+)/i.exec(text);
    const range = bounds ?? rangeMass;
    const accel = /acceleration\s*(?:is|=|of)?\s*([\d.]+)/i.exec(text);
    variables = { massStart: Number(range?.[1] ?? 1), massEnd: Number(range?.[2] ?? 10), massStep: 1, acceleration: Number(accel?.[1] ?? acceleration?.[1] ?? 5) };
    equations = ['F = m * a'];
    relationships = [{ from: 'mass', relation: 'interacts_with', to: 'acceleration' }, { from: 'mass', relation: 'depends_on', to: 'force' }, { from: 'acceleration', relation: 'causes', to: 'force' }];
    labels = ['Force', 'Mass', 'Acceleration'];
  } else if (/\bconvert\b/i.test(text)) {
    intent = 'convert_units'; domain = 'mathematics';
    const conversion = /convert\s+([\d.]+)\s*([a-z]+)\s+to\s+([a-z]+)/i.exec(text);
    variables = { value: Number(conversion?.[1]), fromUnit: conversion?.[2]?.toLowerCase(), toUnit: conversion?.[3]?.toLowerCase() };
    requestedOutputs = ['numeric_result', 'unit_conversion'];
  } else if (/\bstandard\s+deviation\b|\bmean\b|\bmedian\b|\bvariance\b|\bcorrelation\b|\bminimum\b|\bmaximum\b/i.test(text)) {
    intent = 'analyze_dataset'; domain = 'statistics';
    const data = /\[([^\]]+)\]/.exec(text)?.[1]?.split(',').map((value) => Number(value.trim()));
    variables = { data, statistic: statisticFromText(lower) };
    requestedOutputs = ['statistical_analysis', 'numeric_result'];
  } else if (mass && acceleration && /\bforce\b/i.test(text)) {
    intent = 'calculate'; domain = 'physics'; concepts = ['force', 'mass', 'acceleration'];
    variables = { mass: Number(mass[1]), acceleration: Number(acceleration[1]), expression: 'mass * acceleration' };
    equations = ['F = m * a']; requestedOutputs = ['numeric_result', 'equation', 'explanation'];
    relationships = [{ from: 'mass', relation: 'interacts_with', to: 'acceleration' }, { from: 'mass', relation: 'produces', to: 'force' }]; labels = ['Force', 'Mass', 'Acceleration'];
  } else if (/\bplot\b|\bgraph\b/i.test(text)) {
    intent = 'plot'; domain = 'mathematics'; requestedOutputs = ['graph', 'structured_scene'];
    const equation = /([a-z_]\w*\s*=\s*[^,?.!]+)/i.exec(text)?.[1]?.trim().replaceAll('²', '^2');
    equations = [equation ?? 'y = x^2']; concepts = ['function'];
    variables = { xMin: -10, xMax: 10, sampleCount: 41 };
  } else if (relationalAction) {
    intent = relationalAction.definition.id; requestedOutputs = ['visual'];
    if (relationalAction.slots.topic) concepts = [slug(relationalAction.slots.topic)];
  } else if (/electric\s+motor/i.test(text)) {
    intent = 'explain'; domain = 'physics'; concepts = ['electric_motor']; requestedOutputs = ['explanation', 'voice', 'visual'];
    labels = ['Electrical energy', 'Current', 'Magnetic field', 'Force', 'Torque', 'Rotation', 'Mechanical motion'];
    relationships = motorRelationships.map(([from, relation, to]) => ({ from, relation, to }));
  } else if (/force/.test(lower) && /mass/.test(lower) && /acceleration/.test(lower)) {
    intent = 'explain'; domain = 'physics'; concepts = ['force', 'mass', 'acceleration']; requestedOutputs = ['explanation', 'visual'];
    labels = ['Force', 'Mass', 'Acceleration'];
    relationships = [{ from: 'force', relation: 'depends_on', to: 'mass' }, { from: 'force', relation: 'produces', to: 'acceleration' }, { from: 'mass', relation: 'interacts_with', to: 'acceleration' }];
  } else if (/\bimage\b|\bphoto\b|\bpicture\b/i.test(text) || modality === 'vision') {
    intent = 'interpret_visual'; domain = 'vision'; modality = 'vision'; concepts = ['image']; requestedOutputs = ['visual_semantics'];
  } else if (/python|function|code/i.test(text)) {
    intent = 'write_code'; domain = 'coding'; concepts = ['compound_interest']; requestedOutputs = ['code', 'explanation'];
  } else if (/dataset|trend|data/i.test(text)) {
    intent = 'analyze_dataset'; domain = 'statistics'; concepts = ['dataset_trend']; requestedOutputs = ['trend_analysis', 'explanation'];
  } else if (/\bcalculate\b|\bsolve\b/i.test(text)) {
    intent = 'calculate'; domain = 'mathematics';
    const expression = /(?:calculate|solve)\s+(.+?)[?!]?$/i.exec(text)?.[1]?.replaceAll('×', '*').replaceAll('÷', '/')?.trim();
    variables = { expression }; requestedOutputs = ['numeric_result', 'equation'];
  } else if (/\bexplain\b/i.test(text)) {
    intent = 'explain'; requestedOutputs = ['explanation'];
  }
  if (!labels.length) labels = concepts.map((concept) => concept.replaceAll('_', ' '));
  return { intent, modality, concepts, entities: labels.map((label) => ({ id: slug(label), label, type: 'concept' })), relationships, actions: task ? [{ id: task.action, type: task.capability }] : [], variables, equations, requestedOutputs, goals: intent === 'unknown' ? [] : [`Perform ${intent.replaceAll('_', ' ')}`], context: { requestText: text, domain, sketch: request.sketch ?? null, sketchLayout: request.sketchLayout ?? null, ...(task ? { task: { action: task.action, target: task.target, capability: task.capability } } : {}) }, confidence: intent === 'unknown' ? 0.35 : 0.91 };
}

function statisticFromText(text) { if (text.includes('standard deviation')) return 'standard_deviation'; if (text.includes('median')) return 'median'; if (text.includes('variance')) return 'variance'; if (text.includes('correlation')) return 'correlation'; if (text.includes('minimum')) return 'min'; if (text.includes('maximum')) return 'max'; return 'mean'; }
function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
