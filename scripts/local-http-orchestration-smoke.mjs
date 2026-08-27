import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const { compilePlan } = await import('../packages/compiler/dist/compile.js');
const source = readFileSync(new URL('../fixtures/runbooks/acme-ingestion-recovery.md', import.meta.url), 'utf8');
const plan = JSON.parse(readFileSync(new URL('../fixtures/compile-plans/acme-ingestion-recovery.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifests/acme-operations.json', import.meta.url), 'utf8'));
for (const capability of manifest.capabilities) { capability.transport.allowed_host = '127.0.0.1:18082'; capability.transport.audience = 'http://127.0.0.1:18082'; }
const document = compilePlan(source, 'fixtures/runbooks/acme-ingestion-recovery.md', plan, manifest).document;

const isolated = { ...process.env, GCP_PROJECT: '', FIRESTORE_EMULATOR_HOST: '' };
const processes = [
  spawn(process.execPath, ['apps/acme-worker/dist/index.js'], { env: { ...isolated, PORT: '18082' }, stdio: 'ignore' }),
  spawn(process.execPath, ['apps/broker/dist/index.js'], { env: { ...isolated, PORT: '18081', DEPLOYMENT_MODE: 'local', LOCAL_TRANSPORT: 'true', LOCAL_MOCK_MUTATION_GATE: 'true', ALLOWED_CAPABILITY_ORIGINS: 'http://127.0.0.1:18082' }, stdio: 'ignore' }),
  spawn(process.execPath, ['apps/control/dist/index.js'], { env: { ...isolated, PORT: '18080', DEPLOYMENT_MODE: 'local', LOCAL_ORCHESTRATION: 'true', BROKER_URL: 'http://127.0.0.1:18081' }, stdio: 'ignore' }),
];
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:18080/health')).ok && (await fetch('http://127.0.0.1:18081/health')).ok && (await fetch('http://127.0.0.1:18082/health')).ok) break; } catch { /* startup */ }
    await wait(100);
    if (attempt === 49) throw new Error('local HTTP services did not start');
  }
  const payload = { execution_id: 'exec-local-http', document, manifest, context: { job_id: 'job-local-http', failure_mode: 'TRANSIENT_UPSTREAM_FAILURE', http_status: 503 } };
  const response = await fetch('http://127.0.0.1:18080/local/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok || result.status !== 'COMPLETED') throw new Error(`local HTTP orchestration failed: ${JSON.stringify(result)}`);
  const replay = await fetch('http://127.0.0.1:18080/local/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const replayed = await replay.json();
  if (!replay.ok || replayed.status !== 'COMPLETED') throw new Error(`replayed orchestration failed: ${JSON.stringify(replayed)}`);
  const mutations = await (await fetch('http://127.0.0.1:18082/proof/mutations')).json();
  if (mutations.unique_business_mutations !== 1) throw new Error(`replay duplicated worker mutation: ${JSON.stringify(mutations)}`);
  mkdirSync('.local/proof', { recursive: true });
  writeFileSync('.local/proof/acme-recovery.json', `${JSON.stringify({
    schema: 'runbook-compiler-proof/v0.1',
    generated_at: new Date().toISOString(),
    evidence_mode: 'LOCAL_HTTP_ORCHESTRATION',
    mutation_authority: 'LOCAL_MOCK_MUTATION_GATE',
    source_sha256: `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`,
    rbir_sha256: `sha256:${createHash('sha256').update(JSON.stringify(document), 'utf8').digest('hex')}`,
    execution: { status: result.status, trace: result.trace, context: result.context },
    replay: { status: replayed.status, trace: replayed.trace },
    worker_mutations: mutations,
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, control: 'healthy', broker: 'healthy', worker: 'healthy', execution: result.status, trace: result.trace, replay: replayed.status, worker_mutations: mutations }));
} finally { for (const child of processes) child.kill('SIGTERM'); }
