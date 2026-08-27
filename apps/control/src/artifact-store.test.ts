import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyArtifactBytes, type AdmittedArtifact } from './artifact-store.js';

const document = { ir_version: 'rbir/v0.1', runbook: { id: 'r', version: 1, compiled_at: '2026-08-27T00:00:00.000Z', compiler_version: 'test', tenant_id: 't' }, source: { uri: 'urn:test', source_sha256: `sha256:${'1'.repeat(64)}` }, capability_manifest: { id: 'm', version: 1, capability_manifest_sha256: `sha256:${'2'.repeat(64)}` }, entry_node: 'end', context_schema: {}, authority_model: [], obligations: [], policy_constraints: [], nodes: [{ id: 'end', kind: 'TERMINAL', description: 'end', statement_ids: [], outcomes: [], terminal: { status: 'RESOLVED', reason: 'done' } }], edges: [] };
const bytes = Buffer.from(JSON.stringify(document));
const admission: AdmittedArtifact = { id: 'artifact', bucket: 'bucket', object: 'sha256/object', generation: '1', rbir_sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, manifest_sha256: document.capability_manifest.capability_manifest_sha256, compiler_identity: 'compiler@test', admitted_at: '2026-08-27T00:00:00.000Z', status: 'ADMITTED' };

test('admission binds exact RBIR bytes, manifest, and generation metadata', () => {
  assert.equal(verifyArtifactBytes(bytes, admission).runbook.id, 'r');
  assert.throws(() => verifyArtifactBytes(Buffer.from(`${bytes.toString()} `), admission), /ARTIFACT_DIGEST_MISMATCH/);
  assert.throws(() => verifyArtifactBytes(bytes, { ...admission, manifest_sha256: `sha256:${'3'.repeat(64)}` }), /ARTIFACT_MANIFEST_MISMATCH/);
});
