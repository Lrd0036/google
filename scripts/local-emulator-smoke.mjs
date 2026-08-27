import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const composeArgs = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const composeEnv = { ...process.env, CONSOLE_PORT: '4174' };
const { canonicalJson, sha256 } = await import('../apps/broker/dist/broker.js');
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifests/acme-operations.json', import.meta.url), 'utf8'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const params = { job_id: 'job-emulator-smoke' };
const lease = { owner: 'local', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString() };

function makeGrant(jti) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti, iat: now, exp: now + 60, execution_id: 'exec-emulator-smoke', node_id: 'retry_job', node_attempt: 1, capability: 'retry_job@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('emulator-ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('emulator-trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  return { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } };
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await wait(250);
  }
  throw new Error(`service did not become healthy: ${url}`);
}

async function dispatch(jti) {
  const response = await fetch('http://127.0.0.1:8081/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: makeGrant(jti), params, manifest, lease, control_epoch: 1, public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString() }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`broker dispatch failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

try {
  execFileSync('docker', [...composeArgs, 'up', '-d', '--build'], { env: composeEnv, stdio: 'ignore' });
  await waitFor('http://127.0.0.1:8085');
  await waitFor('http://127.0.0.1:8086');
  await waitFor('http://127.0.0.1:8081/health');
  await waitFor('http://127.0.0.1:8082/health');
  const first = await dispatch('emulator-smoke-1');
  execFileSync('docker', [...composeArgs, 'restart', 'rb-broker'], { env: composeEnv, stdio: 'ignore' });
  await waitFor('http://127.0.0.1:8081/health');
  const afterRestart = await dispatch('emulator-smoke-2');
  if (first.idempotency_key !== afterRestart.idempotency_key || afterRestart.status !== 'COMPLETED') throw new Error('durable operation replay assertion failed');
  console.log(JSON.stringify({ ok: true, broker: 'healthy', firestore_operation_replay: true, idempotency_key: afterRestart.idempotency_key }));
} catch (error) {
  try { execFileSync('docker', [...composeArgs, 'logs', '--no-color', '--tail=80', 'rb-broker', 'acme-worker'], { env: composeEnv, stdio: 'inherit' }); } catch { /* preserve original failure */ }
  throw error;
} finally {
  execFileSync('docker', [...composeArgs, 'down'], { env: composeEnv, stdio: 'ignore' });
}
