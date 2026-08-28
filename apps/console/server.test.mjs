import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createConsoleServer, royalDukeUpstreamPath } from './server.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('Royal Duke routes map only bounded same-origin paths to the controller API', () => {
  assert.equal(royalDukeUpstreamPath('GET', '/api/royal-duke/state'), '/api/v1/state');
  assert.equal(royalDukeUpstreamPath('GET', '/api/royal-duke/events'), '/api/v1/events');
  assert.equal(royalDukeUpstreamPath('POST', '/api/royal-duke/actions/freeze_hmi'), '/api/v1/actions/freeze_hmi');
  assert.equal(royalDukeUpstreamPath('GET', '/api/royal-duke/state', '?sync=false'), '/api/v1/state?sync=false');
  assert.equal(royalDukeUpstreamPath('POST', '/api/royal-duke/arbitrary'), null);
  assert.equal(royalDukeUpstreamPath('GET', '/api/royal-duke/actions/freeze_hmi'), null);
});

test('Royal Duke proxy requires IAP and forwards state to the allowlisted upstream route', async (t) => {
  let observedPath = '';
  const upstream = createServer((request, response) => {
    observedPath = request.url ?? '';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ revision: 7 }));
  });
  const upstreamUrl = await listen(upstream);
  const consoleServer = createConsoleServer({ rangeControllerUrl: upstreamUrl });
  const consoleUrl = await listen(consoleServer);
  t.after(async () => { await close(consoleServer); await close(upstream); });

  const denied = await fetch(`${consoleUrl}/api/royal-duke/state`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${consoleUrl}/api/royal-duke/state`, {
    headers: { 'x-goog-iap-jwt-assertion': 'test-iap-assertion' },
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { revision: 7 });
  assert.equal(observedPath, '/api/v1/state');
});

test('event stream is forwarded incrementally and preserves Last-Event-ID', async (t) => {
  let releaseSecond;
  let observedLastEventId = '';
  const waitForRelease = new Promise((resolve) => { releaseSecond = resolve; });
  const upstream = createServer(async (request, response) => {
    observedLastEventId = String(request.headers['last-event-id'] ?? '');
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    response.write('id: 8\nevent: state\ndata: {"revision":8}\n\n');
    await waitForRelease;
    response.end('id: 9\nevent: state\ndata: {"revision":9}\n\n');
  });
  const upstreamUrl = await listen(upstream);
  const consoleServer = createConsoleServer({ rangeControllerUrl: upstreamUrl });
  const consoleUrl = await listen(consoleServer);
  t.after(async () => { releaseSecond(); await close(consoleServer); await close(upstream); });

  const response = await fetch(`${consoleUrl}/api/royal-duke/events`, {
    headers: {
      'x-goog-iap-jwt-assertion': 'test-iap-assertion',
      'last-event-id': '7',
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /"revision":8/);
  assert.equal(observedLastEventId, '7');

  releaseSecond();
  await reader.cancel();
});
