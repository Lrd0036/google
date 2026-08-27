import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const port = 18083;
const worker = spawn(process.execPath, ['apps/acme-worker/dist/index.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
async function call(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* startup */ }
    await wait(100);
    if (attempt === 39) throw new Error('fault-test worker did not start');
  }
  const transient1 = await call('/capabilities/retry', { job_id: 'fault-transient', fault_mode: 'TRANSIENT_ONCE' }, { 'Idempotency-Key': 'fault-key-1' });
  const transient2 = await call('/capabilities/retry', { job_id: 'fault-transient' }, { 'Idempotency-Key': 'fault-key-1' });
  const replay = await call('/capabilities/retry', { job_id: 'fault-transient' }, { 'Idempotency-Key': 'fault-key-1' });
  const malformed = await call('/capabilities/retry', { job_id: 'fault-malformed', fault_mode: 'MALFORMED' });
  const injection = await call('/capabilities/retry', { job_id: 'fault-injection', fault_mode: 'INJECTION' });
  const expired = await call('/capabilities/retry', { job_id: 'fault-auth', fault_mode: 'AUTH_EXPIRED' });
  const rotated = await call('/capabilities/rotate-auth', {});
  const recovered = await call('/capabilities/retry', { job_id: 'fault-auth' });
  const unknown = await fetch(`${base}/operations/missing`);
  if (transient1.response.status !== 503 || transient2.response.status !== 200 || replay.response.status !== 200 || replay.body.operation_id !== transient2.body.operation_id || malformed.response.status !== 400 || injection.response.status !== 400 || expired.response.status !== 401 || rotated.response.status !== 200 || recovered.response.status !== 200 || unknown.status !== 404) throw new Error('fault matrix assertion failed');
  console.log(JSON.stringify({ ok: true, transient_retry: true, idempotent_replay: true, malformed_rejected: true, injection_contained: true, auth_recovery: true, unknown_operation_rejected: true }));
} finally { worker.kill('SIGTERM'); }
