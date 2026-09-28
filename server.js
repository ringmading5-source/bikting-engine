import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createBiktingRuntime } from './src/runtime/BiktingRuntime.js';
import { createGeminiInterpreter } from './src/server/geminiInterpreter.js';
import { createDefaultRegistries } from './src/bikting/core/registry/createDefaultRegistries.js';
import { ModelRegistry } from './src/bikting/core/models/ModelRegistry.js';
import { createModelAdapter } from './src/bikting/core/models/adapters/ModelAdapter.js';
import { listVisualTools } from './src/visualization/visualToolCatalog.js';
import { mockSemanticInterpreter } from './src/bikting/core/adapters/mockSemanticInterpreter.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const plotlyBundle = resolve(root, 'node_modules/plotly.js-dist-min/plotly.min.js');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '0.0.0.0';
const geminiEnabled = Boolean(process.env.GEMINI_API_KEY);
const testToken = process.env.BIKTING_TEST_TOKEN;
if (geminiEnabled && (!testToken || testToken.length < 16)) throw new Error('BIKTING_TEST_TOKEN must have at least 16 characters when Gemini is enabled.');
const defaults = createDefaultRegistries();
const models = new ModelRegistry();
if (geminiEnabled) models.register(createModelAdapter({
  id: 'gemini.interpretation-text', name: 'Gemini interpretation text', domain: 'language', modalities: ['text'], capabilities: ['text.generate'],
  metadata: { provider: 'gemini' }, methods: { async generate(semantic) { return { type: 'explan…960 tokens truncated…      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(defaults.tools.capabilityCatalog().map(({ id, domain, operation, acceptedInputs, producedOutputs }) => ({ id, domain, operation, acceptedInputs, producedOutputs }))));
      return;
    }
    if (pathname === '/api/visual-tools') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(listVisualTools()));
      return;
    }
    if (pathname === '/vendor/plotly.min.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      response.end(await readFile(plotlyBundle));
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = resolve(root, relativePath);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Not found');
    const publicFile = relativePath === 'index.html' || relativePath === 'styles.css' || (relativePath.startsWith('src/') && !relativePath.startsWith('src/server/') && ['.js', '.json', '.svg'].includes(extname(relativePath)) && !relativePath.split('/').some((segment) => segment.startsWith('.')));
    if (!publicFile) throw new Error('Not found');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => console.log(`Bikting Engine workspace listening on ${host}:${port}`));

function validToken(provided, expected) {
  if (typeof provided !== 'string') return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
