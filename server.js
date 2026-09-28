import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewIntent, runWebsiteFromIntent } from './.runtime-build/src/runtime/canonical-preview.js';
import { runLocalCalculation } from './.runtime-build/src/runtime/local-calculation.js';
import { searchPublicKnowledge } from './.runtime-build/src/knowledge/public-web-search.js';
import { createDefaultIntentRules } from './.runtime-build/src/runtime/intent-router.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const intentRules = createDefaultIntentRules();
const staticPaths = new Set(['index.html', 'styles.css', 'src/main.js', 'src/input/textInput.js', 'src/workspace/mathVisual.js']);
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);
const pilotMode = process.env.PILOT_MODE === 'true';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
if (host !== '127.0.0.1' && host !== 'localhost' && !pilotMode) throw new Error('A non-local HOST requires PILOT_MODE=true.');
if (pilotMode && (!process.env.PILOT_USERNAME || !process.env.PILOT_PASSWORD || process.env.PILOT_PASSWORD.length < 16)) throw new Error('Pilot mode requires PILOT_USERNAME and a PILOT_PASSWORD of at least 16 characters.');
const requestsByAddress = new Map();
function allowedRate(address) {
  const now = Date.now();
  for (const [key, value] of requestsByAddress) if (now - value.since > 60_000) requestsByAddress.delete(key);
  const entry = requestsByAddress.get(address);
  if (!entry) { requestsByAddress.set(address, { since: now, count: 1 }); return true; }
  entry.count += 1;
  return entry.count <= 120;
}
function equalSecret(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}
function authorized(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return false;
  const encoded = header.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2048) return false;
  const credentials = Buffer.from(encoded, 'base64').toString('utf8');
  return equalSecret(credentials, `${process.env.PILOT_USERNAME}:${process.env.PILOT_PASSWORD}`);
}
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/healthz') { response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('ok'); return; }
    if (!allowedRate(request.socket.remoteAddress ?? 'unknown')) { response.writeHead(429); response.end('Request limit reached. Try again shortly.'); return; }
    if (pilotMode && !authorized(request.headers.authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bikting private pilot", charset="UTF-8"' });
      response.end('Private pilot access required.'); return;
    }
    if (pathname === '/api/route' || pathname === '/api/preview' || pathname === '/api/calculate' || pathname === '/api/calculate/live' || pathname === '/api/scaffold' || pathname === '/api/scaffold/live' || pathname === '/api/knowledge' || pathname === '/api/knowledge/live') {
      if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 8192) { response.writeHead(413); response.end(); return; }
      }
      let input;
      try { input = JSON.parse(body); } catch { response.writeHead(400); response.end('Invalid JSON'); return; }
      try {
        if (pathname === '/api/calculate/live') {
          // Validate before opening the stream, then forward actual kernel transitions.
          if (typeof input.expression !== 'string' || !input.expression.trim() || input.expression.length > 200 || !/^[\d\s.+\-*/%^()×÷eE]+$/.test(input.expression)) throw new TypeError('Enter a numeric arithmetic expression up to 200 characters.');
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
          const send = (entry) => { if (!response.destroyed) response.write(`${JSON.stringify(entry)}\n`); };
          try {
            const result = await runLocalCalculation(input.expression, (event) => send({ kind: 'event', event: { type: event.type, sequence: event.sequence, providerId: event.providerId, data: event.data } }));
            send({ kind: 'result', result });
          } catch (error) { send({ kind: 'error', error: error.message }); }
          response.end(); return;
        }
        if (pathname === '/api/scaffold/live' || pathname === '/api/knowledge/live') {
          if (pathname === '/api/knowledge/live' && (typeof input.topic !== 'string' || !input.topic.trim() || input.topic.length > 120)) throw new TypeError('Enter a topic between 1 and 120 characters.');
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
          const send = (entry) => { if (!response.destroyed) response.write(`${JSON.stringify(entry)}\n`); };
          try {
            if (pathname === '/api/scaffold/live') {
              const result = await runWebsiteFromIntent(input.text, input.planId, (event) => send({ kind: 'event', event: { type: event.type, sequence: event.sequence, providerId: event.providerId, data: event.data } }));
              send({ kind: 'result', result });
            } else {
              send({ kind: 'event', event: { type: 'knowledge_retrieval_started', providerId: 'wikipedia.public_search' } });
              const result = await searchPublicKnowledge(input.topic);
              send({ kind: 'event', event: { type: 'knowledge_retrieval_completed', providerId: 'wikipedia.public_search', data: { count: result.results.length } } });
              send({ kind: 'result', result });
            }
          } catch (error) { send({ kind: 'error', error: error.message }); }
          response.end(); return;
        }
        const result = pathname === '/api/route' ? { route: intentRules.resolve(input.text) }
          : pathname === '/api/calculate' ? await runLocalCalculation(input.expression)
          : pathname === '/api/scaffold' ? await runWebsiteFromIntent(input.text, input.planId)
          : pathname === '/api/knowledge' ? await searchPublicKnowledge(input.topic) : await previewIntent(input.text);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!staticPaths.has(relativePath)) throw new Error('Not found');
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

server.listen(port, host, () => console.log(`Bikting Engine workspace listening on ${host}:${server.address().port}${pilotMode ? ' (private pilot)' : ''}`));
