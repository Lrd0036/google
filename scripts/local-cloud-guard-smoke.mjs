import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const control = spawn(process.execPath, ['apps/control/dist/index.js'], {
  env: { ...process.env, PORT: '18090', DEPLOYMENT_MODE: 'cloud' },
  stdio: 'ignore',
});

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:18090/health')).ok) break; } catch { /* startup */ }
    await wait(100);
    if (attempt === 39) throw new Error('control did not start');
  }

  const routes = ['/executions', '/local/execute', '/local/approve', '/events/resume'];
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:18090${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (response.status !== 404) throw new Error(`cloud-mode route ${route} returned ${response.status}`);
  }
  console.log(JSON.stringify({ ok: true, cloud_mode_fail_closed: routes }));
} finally {
  control.kill('SIGTERM');
}
