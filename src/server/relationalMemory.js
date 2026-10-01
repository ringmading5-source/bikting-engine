import { createHash } from 'node:crypto';

const normalize = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const words = value => normalize(value).match(/[\p{L}\p{N}_]+/gu) ?? [];
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const bindings = value => plain(value) && Object.entries(value).length <= 64 && Object.entries(value).every(([key, item]) => text(key) && ['string', 'boolean', 'number'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item)) && (typeof item !== 'string' || item.length <= 2000));
const matches = (state, required) => Object.entries(required).every(([key, value]) => Object.hasOwn(state, key) && state[key] === value);

/** Deterministic signed feature hashing; no learned embedding weights. */
export function featureVector(value, dimensions = 128) {
  const vector = Array(dimensions).fill(0);
  for (const word of words(value)) {
    const hash = createHash('sha256').update(word).digest();
    vector[hash.readUInt32BE(0) % dimensions] += hash[4] & 1 ? 1 : -1;
  }
  const length = Math.hypot(...vector);
  return length ? vector.map(item => item / length) : vector;
}

function validate(record) {
  if (!plain(record) || !text(record.id) || !['fact', 'procedure'].includes(record.kind) || !text(record.text) || !text(record.source) ||
      !['approved', 'candidate'].includes(record.review) || !bindings(record.context ?? {}) ||
      !Number.isFinite(record.expiresAt) || !Array.isArray(record.queries) || record.queries.length > 20 || !record.queries.every(text)) throw new TypeError('Invalid memory record.');
  if (record.kind === 'fact' && (!text(record.subject) || !text(record.predicate) || !text(record.value))) throw new TypeError('A fact requires subject, predicate, and value.');
  if (record.kind === 'procedure' && (!bindings(record.preconditions) || !bindings(record.effects) || !Object.keys(record.effects).length)) throw new TypeError('A procedure requires bounded preconditions and effects.');
  return structuredClone({ ...record, context: record.context ?? {} });
}

/** Bounded relational memory persisted through the configured file/database store. */
export function createRelationalMemory({ knowledgeStore, now = Date.now, maxRecords = 256 }) {
  const key = 'relational-memory:v1';
  let writing = Promise.resolve();
  const load = async () => (await knowledgeStore.get(key) ?? []).filter(record => record.expiresAt > now());
  return {
    async remove({ id }) {
      if (!text(id)) throw new TypeError('A memory id is required.');
      const update = writing.then(async () => {
        const records = await load();
        const remaining = records.filter(record => record.id !== id);
        await knowledgeStore.set(key, remaining);
        return { status: remaining.length < records.length ? 'removed' : 'not_found', id };
      });
      writing = update.catch(() => {});
      return update;
    },
    async put(record) {
      const checked = validate(record);
      if (checked.expiresAt <= now()) throw new TypeError('Memory record is already expired.');
      const update = writing.then(async () => {
        const records = await load();
        const next = records.filter(item => item.id !== checked.id);
        if (next.length >= maxRecords) throw new RangeError('Memory capacity reached.');
        next.push(checked);
        await knowledgeStore.set(key, next);
        return { id: checked.id, status: 'stored', review: checked.review };
      });
      writing = update.catch(() => {});
      return update;
    },
    async retrieve({ query, context = {}, limit = 5 }) {
      if (!text(query) || !bindings(context) || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new TypeError('Invalid retrieval request.');
      const tokens = new Set(words(query));
      const vector = featureVector(query);
      return (await load()).map(record => {
        const candidate = `${record.text} ${record.queries.join(' ')} ${record.subject ?? ''} ${record.predicate ?? ''}`;
        const lexical = words(candidate).filter(word => tokens.has(word)).length / Math.max(1, words(candidate).length);
        const similarity = featureVector(candidate).reduce((sum, value, index) => sum + value * vector[index], 0);
        const exact = record.queries.some(value => normalize(value) === normalize(query));
        const applicable = record.review === 'approved' && matches(context, record.context);
        return { record, exact, applicable, score: (exact ? 2 : 0) + lexical + Math.max(0, similarity), match: exact ? 'exact' : 'candidate' };
      }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id)).slice(0, limit);
    },
    async answer({ query, context = {} }) {
      const candidates = await this.retrieve({ query, context, limit: 20 });
      const eligible = (await load()).filter(record => record.kind === 'fact' && record.review === 'approved' && matches(context, record.context) && record.queries.some(value => normalize(value) === normalize(query))).map(record => ({ record }));
      if (!eligible.length) return { status: 'needs_knowledge', candidates, modelCalls: 0 };
      // Competing exact answers are never resolved by ranking alone.
      if (new Set(eligible.map(item => item.record.value)).size > 1) return { status: 'conflict', candidates: eligible, modelCalls: 0 };
      return { status: 'resolved', text: eligible[0].record.value, evidence: eligible.map(item => ({ id: item.record.id, source: item.record.source, review: item.record.review })),
        verification: 'operator_approved', modelCalls: 0 };
    },
    async plan({ state, goals, context = {}, maxDepth = 8, maxNodes = 256 }) {
      if (!bindings(state) || !bindings(goals) || !Object.keys(goals).length || !bindings(context) || !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 16 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 1024) throw new TypeError('Invalid planning request.');
      const procedures = (await load()).filter(record => record.kind === 'procedure' && record.review === 'approved' && matches(context, record.context));
      // Backward goal relevance bounds the set of procedures for forward search.
      const needed = new Map(Object.entries(goals).map(([name, value]) => [JSON.stringify([name, value]), [name, value]]));
      const relevant = new Set();
      for (let pass = 0; pass < procedures.length; pass++) {
        let changed = false;
        for (const procedure of procedures) {
          if (relevant.has(procedure.id) || !Object.entries(procedure.effects).some(([name, value]) => needed.has(JSON.stringify([name, value])))) continue;
          relevant.add(procedure.id); changed = true;
          for (const pair of Object.entries(procedure.preconditions)) needed.set(JSON.stringify(pair), pair);
        }
        if (!changed) break;
      }
      const signature = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
      const queue = [{ state: structuredClone(state), path: [] }];
      const seen = new Set([signature(state)]);
      let visited = 0;
      let depthLimited = false;
      while (queue.length && visited < maxNodes) {
        const current = queue.shift(); visited++;
        if (matches(current.state, goals)) return { status: 'planned', verification: 'predicted', steps: current.path, predictedState: current.state, visited, modelCalls: 0 };
        if (current.path.length >= maxDepth) { depthLimited = true; continue; }
        for (const procedure of procedures) {
          if (!relevant.has(procedure.id) || !matches(current.state, procedure.preconditions)) continue;
          const next = Object.assign(Object.create(null), current.state, procedure.effects);
          const id = signature(next);
          if (seen.has(id)) continue;
          // Bound frontier size as well as expanded nodes.
          if (seen.size >= maxNodes) return { status: 'budget_exhausted', visited, modelCalls: 0 };
          seen.add(id); queue.push({ state: next, path: [...current.path, { id: procedure.id, source: procedure.source, preconditions: procedure.preconditions, effects: procedure.effects }] });
        }
      }
      return { status: queue.length || depthLimited ? 'budget_exhausted' : 'needs_knowledge', visited, modelCalls: 0 };
    },
  };
}
