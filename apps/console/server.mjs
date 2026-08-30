import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { buildMeta } from './meta.mjs';

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function isLocalAudience(audience) {
  if (!audience) return true;
  try {
    return ['localhost', '127.0.0.1', 'host.docker.internal'].includes(new URL(audience).hostname);
  } catch {
    return false;
  }
}

async function serviceHeaders(audience) {
  if (!audience || process.env.GOOGLE_APPLICATION_CREDENTIALS === 'local' || isLocalAudience(audience)) return {};
  return new GoogleAuth().getIdTokenClient(audience).then((client) => client.getRequestHeaders(audience));
}

async function controlReachable(controlUrl) {
  if (!controlUrl) return false;
  try {
    const headers = await serviceHeaders(controlUrl);
    const response = await fetch(`${controlUrl}/health`, { headers, signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

function loadReport() {
  const path = process.env.BENCHMARK_REPORT_PATH;
  if (!path || !existsSync(path)) return undefined;
  try {
    const bytes = readFileSync(path);
    const report = JSON.parse(bytes.toString('utf8'));
    Object.defineProperty(report, '__file_sha256', {
      value: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      enumerable: false,
    });
    return report;
  } catch {
    return undefined;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_048_576) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function copyUpstreamHeaders(upstream, streaming) {
  const headers = {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': upstream.headers.get('cache-control') ?? 'no-store',
    'x-content-type-options': 'nosniff',
  };
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) headers['content-disposition'] = disposition;
  if (streaming) headers['x-accel-buffering'] = 'no';
  return headers;
}

async function proxy(request, response, targetBase, path, { streaming = false } = {}) {
  try {
    const iapJwt = String(request.headers['x-goog-iap-jwt-assertion'] ?? '');
    if (!iapJwt) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'IAP_ASSERTION_REQUIRED' }));
      return;
    }

    const headers = new Headers(await serviceHeaders(targetBase));
    headers.set('content-type', String(request.headers['content-type'] ?? 'application/json'));
    headers.set('x-runbook-iap-jwt', iapJwt);
    const lastEventId = request.headers['last-event-id'];
    if (lastEventId) headers.set('last-event-id', String(lastEventId));

    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);
    const upstream = await fetch(`${targetBase}${path}`, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });

    response.writeHead(upstream.status, copyUpstreamHeaders(upstream, streaming));
    if (streaming && upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), response);
      return;
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const tooLarge = error instanceof Error && error.message === 'REQUEST_BODY_TOO_LARGE';
    response.writeHead(tooLarge ? 413 : 502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: tooLarge ? 'REQUEST_BODY_TOO_LARGE' : 'UPSTREAM_UNAVAILABLE' }));
  }
}

export function royalDukeUpstreamPath(method, pathname, search = '') {
  const prefix = '/api/royal-duke';
  if (!pathname.startsWith(`${prefix}/`)) return null;
  const suffix = pathname.slice(prefix.length);
  const readable = /^\/(?:state|events|graph|fleet\/(?:bundle|report))$/;
  const writable = /^\/(?:reset|fleet\/approve|actions\/[a-z0-9_]+|defensive\/[a-z-]+)$/;
  if (method === 'GET' && readable.test(suffix)) return `/api/v1${suffix}${search}`;
  if (method === 'POST' && writable.test(suffix)) return `/api/v1${suffix}${search}`;
  return null;
}

export function createConsoleServer(options = {}) {
  const root = options.root ?? join(process.cwd(), 'dist');
  const controlUrl = options.controlUrl ?? process.env.CONTROL_URL ?? '';
  const authorityUrl = options.authorityUrl ?? process.env.AUTHORITY_URL ?? '';
  const rangeControllerUrl = options.rangeControllerUrl ?? process.env.ROYAL_DUKE_CONTROLLER_URL ?? '';
  const configuredMode = options.configuredMode ?? process.env.CONSOLE_DATA_MODE ?? 'DEMO';

  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/api/meta') {
      const meta = buildMeta({
        configuredMode,
        iapJwt: String(request.headers['x-goog-iap-jwt-assertion'] ?? ''),
        controlReachable: await controlReachable(controlUrl),
        report: loadReport(),
        expectedReportDigest: process.env.BENCHMARK_REPORT_SHA256,
      });
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(meta));
      return;
    }

    const rangePath = royalDukeUpstreamPath(request.method ?? 'GET', url.pathname, url.search);
    if (rangePath) {
      if (!rangeControllerUrl) {
        response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: 'ROYAL_DUKE_CONTROLLER_UNAVAILABLE' }));
        return;
      }
      await proxy(request, response, rangeControllerUrl, rangePath, { streaming: url.pathname === '/api/royal-duke/events' });
      return;
    }

    if (url.pathname.startsWith('/api/royal-duke/')) {
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: 'ROYAL_DUKE_ROUTE_NOT_ALLOWED' }));
      return;
    }

    if (url.pathname.startsWith('/api/approvals/') && url.pathname.endsWith('/decisions') && authorityUrl) {
      await proxy(request, response, authorityUrl, url.pathname.slice(4));
      return;
    }
    if (url.pathname.startsWith('/api/') && controlUrl) {
      await proxy(request, response, controlUrl, url.pathname.slice(4));
      return;
    }

    let path;
    try {
      path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain', 'x-content-type-options': 'nosniff' });
      response.end('Bad Request');
      return;
    }
    let target = join(root, path === '/' ? 'index.html' : path);
    if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) target = join(root, 'index.html');
    response.writeHead(200, {
      'content-type': mime[extname(target)] || 'application/octet-stream',
      'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'self'; connect-src 'self' https://server.arcgisonline.com https://*.basemaps.cartocdn.com https://tiles.openfreemap.org; img-src 'self' data: blob: https://server.arcgisonline.com https://*.basemaps.cartocdn.com; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(target).pipe(response);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const configuredMode = process.env.CONSOLE_DATA_MODE ?? 'DEMO';
  createConsoleServer({ configuredMode }).listen(port, () => console.log(`[rb-console] listening on ${port} (${configuredMode})`));
}
