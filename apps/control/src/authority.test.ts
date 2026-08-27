import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { issueApprovalAssertion, MemoryApprovalReplayStore, verifyApprovalAssertion } from './authority.js';

test('approval assertion is signed, context-bound, and single-use', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const context = { tenant_id: 'tenant', authority_id: 'auth-1', execution_id: 'exec-1', runbook_ir_sha256: `sha256:${'a'.repeat(64)}`, node_id: 'approve', trigger_sha256: `sha256:${'b'.repeat(64)}`, target_scope_sha256: `sha256:${'c'.repeat(64)}`, issuer: 'local-authority', audience: 'rb-control' };
  const assertion = issueApprovalAssertion(context, 'oidc:user', 'APPROVE', privateKey);
  assert.equal(verifyApprovalAssertion(assertion, publicKey, { ...context, principal: 'oidc:user', decision: 'APPROVE' }).decision, 'APPROVE');
  const replay = new MemoryApprovalReplayStore();
  assert.equal(replay.consume(assertion), true);
  assert.equal(replay.consume(assertion), false);
  assert.throws(() => verifyApprovalAssertion(assertion, publicKey, { ...context, node_id: 'other' }), /CONTEXT_MISMATCH/);
});
