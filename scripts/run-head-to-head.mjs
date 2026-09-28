import { createGeminiWorker } from '../.runtime-build/src/runtime/gemini-worker.js';
import { pilotCases, runTrial } from '../.runtime-build/src/evaluation/head-to-head.js';

if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) {
  console.error('Set GEMINI_API_KEY and GEMINI_MODEL in the process environment to run live trials.');
  process.exitCode = 1;
} else {
  const results = [];
  for (const [index, task] of pilotCases.entries()) {
    const arms = index % 2 ? ['bikting', 'direct'] : ['direct', 'bikting'];
    for (const arm of arms) {
      const worker = createGeminiWorker({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
      const result = await runTrial(task, arm, worker);
      results.push(result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  }
  const aggregate = Object.fromEntries(['direct', 'bikting'].map((arm) => {
    const rows = results.filter((row) => row.arm === arm);
    return [arm, { passed: rows.filter((row) => row.success).length, total: rows.length, unsafeCalls: rows.reduce((sum, row) => sum + row.unsafeCalls, 0), toolCalls: rows.reduce((sum, row) => sum + row.toolCalls, 0), durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0) }];
  }));
  process.stdout.write(`${JSON.stringify({ aggregate, note: 'Pilot tasks only; token cost and general task quality are not measured.' })}\n`);
}
