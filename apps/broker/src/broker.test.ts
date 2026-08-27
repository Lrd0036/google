import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { dispatchActionGrant, MemoryGrantReplayStore, MemoryOperationStore, MetricsRegistry, canonicalJson, idempotencyKey, resolveCapabilityUrl, sha256, verifyActionGrant } from './broker.js';
import type { CapabilityManifest } from '@runbook/types';

const localDispatchPolicy = { allowRequestCarriedFence: true, allowedOrigins: ['https://example.test'] } as const;

test('broker enforces manifest binding and single-use grants', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }, output_schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = { value: 'ok' };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'jti-1', iat: now, exp: now + 100, execution_id: 'e', node_id: 'n', node_attempt: 1, capability: 'echo@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const signature = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  const grant = { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256' as const, key_id: 'local', value: signature } };
  const request = { grant, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store: new MemoryOperationStore(), replayStore: new MemoryGrantReplayStore(), ...localDispatchPolicy, fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }) };
  const first = await dispatchActionGrant(request);
  assert.equal(first.status, 'COMPLETED');
  await assert.rejects(() => dispatchActionGrant(request), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'GRANT_REPLAYED');
});

test('broker exposes local safety counters', () => {
  const metrics = new MetricsRegistry();
  metrics.increment('action_completed_total', 2);
  assert.match(metrics.prometheus(), /runbook_action_completed_total 2/);
});

test('reconcilable transport loss is persisted as uncertain', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'drain', version: 1, description: 'drain', semantic_actions: ['drain'], mode: 'WRITE', risk: 'R2_STATEFUL', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'RECONCILABLE', reconcile_capability: 'status@1' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = { queue_id: 'q' };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'uncertain-jti', iat: now, exp: now + 60, execution_id: 'uncertain-exec', node_id: 'drain', node_attempt: 1, capability: 'drain@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  const store = new MemoryOperationStore();
  await assert.rejects(() => dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store, ...localDispatchPolicy, fetchImpl: async () => { throw new TypeError('socket closed'); } }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'OPERATION_UNCERTAIN');
  assert.equal((await store.get(idempotencyKey('uncertain-exec', 'drain', 0)))?.status, 'UNCERTAIN');
});

test('a signed reconciliation grant can clear only a recorded uncertain operation', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'status', version: 1, description: 'status', semantic_actions: ['status'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/operations/{operation_id}', method: 'GET' }, input_schema: { type: 'object', required: ['operation_id'], properties: { operation_id: { type: 'string' } } }, output_schema: { type: 'object', required: ['operation_id', 'status'], properties: { operation_id: { type: 'string' }, status: { type: 'string' } } }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const store = new MemoryOperationStore();
  const key = idempotencyKey('e', 'drain', 0);
  await store.createIfAbsent({ key_hash: key, execution_id: 'e', node_id: 'drain', operation_generation: 0, capability: 'drain@1', params_sha256: sha256({ queue_id: 'q' }), status: 'UNCERTAIN', reconcile_capability: 'status@1' });
  const params = { operation_id: 'op-1' };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'reconcile-jti', iat: now, exp: now + 60, execution_id: 'e', node_id: 'drain', node_attempt: 1, capability: 'status@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  const result = await dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store, ...localDispatchPolicy, fetchImpl: async () => new Response(JSON.stringify({ operation_id: 'op-1', status: 'COMPLETED' }), { status: 200 }) });
  assert.equal(result.status, 'RECONCILED');
  assert.equal((await store.get(key))?.status, 'COMPLETED');
});

test('broker rejects grants minted by the wrong trust boundary', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const grant = {
    typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'issuer-test', iat: now, exp: now + 60,
    execution_id: 'exec', node_id: 'node', node_attempt: 1, capability: 'retry_job@1', params_sha256: sha256({ job_id: 'j' }),
    runbook_ir_sha256: `sha256:${'a'.repeat(64)}`, manifest_sha256: `sha256:${'b'.repeat(64)}`, trigger_sha256: `sha256:${'c'.repeat(64)}`,
    lease_generation: 1, control_epoch: 1, authority_assertion_ids: [],
  };
  const signature = sign('sha256', Buffer.from(canonicalJson(grant)), { key: privateKey, padding: 6, saltLength: 32 }).toString('base64');
  assert.throws(() => verifyActionGrant({ grant: { ...grant, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'test', value: signature } }, params: { job_id: 'j' }, lease: { owner: 'x', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, expectedRunbookIrSha256: `sha256:${'d'.repeat(64)}`, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'RUNBOOK_MISMATCH');
});

test('idempotency tuples are canonically framed', () => {
  assert.notEqual(idempotencyKey('a', 'bc', 1), idempotencyKey('ab', 'c', 1));
  assert.match(idempotencyKey('a', 'bc', 1), /^v2:[a-f0-9]{64}$/);
});

test('existing idempotency records reject a different signed operation', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = { value: 'new' };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'identity-jti', iat: now, exp: now + 60, execution_id: 'e', node_id: 'n', node_attempt: 1, capability: 'echo@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  const store = new MemoryOperationStore();
  await store.createIfAbsent({ key_hash: idempotencyKey('e', 'n', 0), execution_id: 'e', node_id: 'n', operation_generation: 0, capability: 'echo@1', params_sha256: sha256({ value: 'old' }), status: 'COMPLETED', response: { ok: true } });
  await assert.rejects(() => dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store, ...localDispatchPolicy, fetchImpl: async () => new Response('{}') }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'IDEMPOTENCY_RECORD_MISMATCH');
});

test('broker rejects capability redirects without following them', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = {};
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'redirect-jti', iat: now, exp: now + 60, execution_id: 'redirect-e', node_id: 'redirect-n', node_attempt: 1, capability: 'echo@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  let redirectMode: string | undefined;
  await assert.rejects(() => dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store: new MemoryOperationStore(), ...localDispatchPolicy, fetchImpl: async (_url, init) => { redirectMode = init?.redirect; return new Response('', { status: 302, headers: { location: 'https://attacker.test/capture' } }); } }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CAPABILITY_REDIRECT_REJECTED');
  assert.equal(redirectMode, 'manual');
});

test('broker rejects destinations outside its configured policy', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'attacker.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = {};
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'destination-jti', iat: now, exp: now + 60, execution_id: 'e', node_id: 'n', node_attempt: 1, capability: 'echo@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  await assert.rejects(() => dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store: new MemoryOperationStore(), ...localDispatchPolicy, fetchImpl: async () => new Response('{}') }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'DESTINATION_NOT_ALLOWED');
});

test('capability URL resolution rejects absolute and network-relative paths', () => {
  const capability: CapabilityManifest['capabilities'][number] = { id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' };
  assert.throws(() => resolveCapabilityUrl({ ...capability, transport: { ...capability.transport, path: 'https://attacker.test/capture' } }, {}, ['https://example.test']), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CAPABILITY_PATH');
  assert.throws(() => resolveCapabilityUrl({ ...capability, transport: { ...capability.transport, path: '//attacker.test/capture' } }, {}, ['https://example.test']), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CAPABILITY_PATH');
  assert.equal(resolveCapabilityUrl(capability, {}, ['https://example.test']).href, 'https://example.test/');
});

test('broker requires current authoritative fencing when configured', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const manifest: CapabilityManifest = { manifest_version: 'rb-capabilities/v0.1', id: 'local', version: 1, capabilities: [{ id: 'echo', version: 1, description: 'echo', semantic_actions: ['echo'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'example.test', path: '/', method: 'POST' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' }] };
  const params = {};
  const now = Math.floor(Date.now() / 1000);
  const unsigned = { typ: 'RB-ACTION-GRANT', version: '0.1', iss: 'rb-control', aud: 'rb-broker', jti: 'fence-jti', iat: now, exp: now + 60, execution_id: 'e', node_id: 'n', node_attempt: 1, capability: 'echo@1', params_sha256: sha256(params), runbook_ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest), trigger_sha256: sha256('trigger'), lease_generation: 1, control_epoch: 1, authority_assertion_ids: [] };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  await assert.rejects(() => dispatchActionGrant({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'local', value } }, params, manifest, lease: { owner: 'w', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 10_000).toISOString() }, controlEpoch: 1, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), store: new MemoryOperationStore(), allowedOrigins: ['https://example.test'], fenceStore: { get: async () => ({ status: 'RUNNING', control_epoch: 2, lease: { generation: 1, expires_at: new Date(Date.now() + 10_000).toISOString() }, runbook: { ir_sha256: sha256('ir'), manifest_sha256: sha256(manifest) } }) }, fetchImpl: async () => new Response('{}') }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'STALE_CONTROL_EPOCH');
});
