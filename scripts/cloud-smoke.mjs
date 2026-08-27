const controlUrl = process.env.CONTROL_URL;
const identityToken = process.env.IDENTITY_TOKEN;
if (!controlUrl || !identityToken) throw new Error('CONTROL_URL and IDENTITY_TOKEN are required');

const routes = [
  { path: '/executions', method: 'GET' },
  { path: '/local/execute', method: 'POST' },
  { path: '/local/approve', method: 'POST' },
  { path: '/events/resume', method: 'POST' },
];
const results = [];
for (const route of routes) {
  const response = await fetch(`${controlUrl}${route.path}`, {
    method: route.method,
    headers: { authorization: `Bearer ${identityToken}`, 'content-type': 'application/json' },
    ...(route.method === 'POST' ? { body: '{}' } : {}),
  });
  if (response.status !== 404) throw new Error(`cloud authority-route guard failed for ${route.path}: HTTP ${response.status}`);
  results.push({ route: route.path, status: response.status });
}
console.log(JSON.stringify({ ok: true, authority_routes_unavailable: results }, null, 2));
