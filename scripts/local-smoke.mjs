import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

process.env.LOCAL_TRANSPORT = 'true';
const { dispatchActionGrant, MemoryGrantReplayStore, MemoryOperationStore, canonicalJson, sha256 } = await import('../apps/broker/dist/broker.js');
const { compilePlan } = await import('../packages/compiler/dist/compile.js');
const { executeLocally } = await import('../apps/control/dist/local-executor.js');
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifests/acme-operations.json', import.meta.url), 'utf8'));
for (const capability of manifest.capabilities) {
  capability.transport.allowed_host = '127.0.0.1:18082';
  capability.transport.audience = 'http://127.0.0.1:18082';
}
const source = readFileSync(new URL('../fixtures/runbooks/acme-ingestion-recovery.md', import.meta.url), 'utf8');
const plan = JSON.parse(readFileSync(new URL('../fixtures/compile-plans/acme-ingestion-recovery.json', import.meta.url), 'utf8'));
const compiled = compilePlan(source, 'fixtures/runbooks/acme-ingestion-recovery.md', plan, manifest);
if (compiled.lint.hasErrors) throw new Error(JSON.stringify(compiled.lint.artifact));
const worker = spawn(process.execPath, ['apps/acme-worker/dist/index.js'], { env: { ...process.env, PORT: '18082' }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:18082/health')).ok) break; } catch { /* wait for startup */ }
    await wait(100);
    if (attempt === 39) throw new Error('local worker did not start');
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const store = new MemoryOperationStore();
  const replayStore = new MemoryGrantReplayStore();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const dispatch = async (node, params, attempt) => {
    const now = Math.floor(Date.now() / 1000);
    const capability = node.kind === 'ACTION' ? node.action.capability : node.verify.capability;
    const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: `local-smoke-${node.id}-${attempt}`, iat: now, exp: now + 60, execution_id: 'exec-local-smoke', node_id: node.id, node_attempt: attempt, capability, params_sha256: sha256(params), runbook_ir_sha256: compiled.document.source.source_sha256, manifest_sha256: sha256(manifest), trigger_sha256: sha256('local-trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
    const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
    return dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'local', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString() }, controlEpoch: 1, publicKey: publicKeyPem, store, replayStore, allowRequestCarriedFence: true, allowedOrigins: ['http://127.0.0.1:18082'], mutationGate: { authorize: async () => undefined } });
  };
  const result = await executeLocally(compiled.document, { job_id: 'job-local-smoke', failure_mode: 'TRANSIENT_UPSTREAM_FAILURE', http_status: 503 }, dispatch);
  if (result.status !== 'COMPLETED') throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ ok: true, worker: 'healthy', execution: result.status, trace: result.trace }));
} finally {
  worker.kill('SIGTERM');
}
