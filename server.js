import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewIntent } from './.runtime-build/src/runtime/canonical-preview.js';
import { runLocalCalculation } from './.runtime-build/src/runtime/local-calculation.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/api/preview' || pathname === '/api/calculate') {
      if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) { response.writeHead(413); response.end(); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { response.writeHead(400); response.end('Invalid JSON'); return; }
      try {
        const result = pathname === '/api/calculate' ? await runLocalCalculation(input.expression) : await previewIntent(input.text);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relativePath.startsWith('.')) throw new Error('Not found');
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

server.listen(8000, '127.0.0.1', () => console.log('Bikting Engine workspace: http://127.0.0.1:8000'));
