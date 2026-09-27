import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/api/preview') {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST required' });
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16_384) return sendJson(response, 413, { error: 'Request too large' });
      }
      let data;
      try { data = JSON.parse(body); } catch { return sendJson(response, 400, { error: 'Invalid JSON' }); }
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4_000 || ![undefined, 'demo', 'live'].includes(data.mode)) return sendJson(response, 400, { error: 'A valid text request and mode are required' });
      try {
        const { previewIntent } = await import('./.engine-build/runtime/preview-pipeline.js');
        if (data.mode === 'live') {
          if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) return sendJson(response, 503, { error: 'Live model is not configured. Set OPENAI_API_KEY and OPENAI_MODEL on the server.' });
          const { createOpenAITransport } = await import('./.engine-build/runtime/openai-transport.js');
          return sendJson(response, 200, await previewIntent(data.text.trim(), { transport: createOpenAITransport(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL), providerId: 'openai.configured' }));
        }
        return sendJson(response, 200, await previewIntent(data.text.trim()));
      } catch (error) {
        console.error('Preview failed:', error);
        return sendJson(response, 500, { error: 'Preview unavailable. Start the app with npm start.' });
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new Error('Not found');
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relativePath.split('/').some((part) => part.startsWith('.')) || relativePath.startsWith('node_modules/') || relativePath.startsWith('tests/')) throw new Error('Not found');
    const path = resolve(root, relativePath);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Not found');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

server.listen(8000, '127.0.0.1', () => console.log('Bikting Engine workspace: http://127.0.0.1:8000'));
