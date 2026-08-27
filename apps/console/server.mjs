import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 8080);
const root = join(process.cwd(), 'dist');
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

createServer((request, response) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
    response.end('Bad Request');
    return;
  }
  let target = join(root, path === '/' ? 'index.html' : path);
  if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) target = join(root, 'index.html');
  response.writeHead(200, {
    'content-type': mime[extname(target)] || 'application/octet-stream',
    'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-security-policy': "default-src 'self'; connect-src 'self' https: http://localhost:8080; img-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(target).pipe(response);
}).listen(port, () => console.log(`[rb-console] listening on ${port}`));
