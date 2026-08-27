import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const { compilePlan } = await import('../packages/compiler/dist/compile.js');
const source = readFileSync(new URL('../fixtures/runbooks/acme-ingestion-recovery.md', import.meta.url), 'utf8');
const plan = JSON.parse(readFileSync(new URL('../fixtures/compile-plans/acme-ingestion-recovery.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifests/acme-operations.json', import.meta.url), 'utf8'));
for (const capability of manifest.capabilities) { capability.transport.allowed_host = '127.0.0.1:18082'; capability.transport.audience = 'http://127.0.0.1:18082'; }
const document = compilePlan(source, 'fixtures/runbooks/acme-ingestion-recovery.md', plan, manifest).document;

const processes = [
  spawn(process.execPath, ['apps/acme-worker/dist/index.js'], { env: { ...process.env, PORT: '18082' }, stdio: 'ignore' }),
  spawn(process.execPath, ['apps/broker/dist/index.js'], { env: { ...process.env, PORT: '18081', LOCAL_TRANSPORT: 'true', ALLOWED_CAPABILITY_ORIGINS: 'http://127.0.0.1:18082' }, stdio: 'ignore' }),
  spawn(process.execPath, ['apps/control/dist/index.js'], { env: { ...process.env, PORT: '18080', DEPLOYMENT_MODE: 'local', LOCAL_ORCHESTRATION: 'true', BROKER_URL: 'http://127.0.0.1:18081' }, stdio: 'ignore' }),
];
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:18080/health')).ok && (await fetch('http://127.0.0.1:18081/health')).ok && (await fetch('http://127.0.0.1:18082/health')).ok) break; } catch { /* startup */ }
    await wait(100);
    if (attempt === 49) throw new Error('local HTTP services did not start');
  }
  const response = await fetch('http://127.0.0.1:18080/local/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: 'exec-local-http', document, manifest, context: { job_id: 'job-local-http', failure_mode: 'TRANSIENT_UPSTREAM_FAILURE' } }) });
  const result = await response.json();
  if (!response.ok || result.status !== 'COMPLETED') throw new Error(`local HTTP orchestration failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ ok: true, control: 'healthy', broker: 'healthy', worker: 'healthy', execution: result.status, trace: result.trace }));
} finally { for (const child of processes) child.kill('SIGTERM'); }
