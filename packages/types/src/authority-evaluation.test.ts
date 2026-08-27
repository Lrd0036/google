import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAuthority } from './authority-evaluation.js';

test('authority evaluation enforces ABAC constraints and use limits', () => {
  const authority = { authority_id: 'auth-1', basis: 'DELEGATED' as const, issuer: { tenant_id: 't', role: 'director' }, grantee: { tenant_id: 't', subject_id: 'user-1', role: 'incident-commander' }, permissions: ['promote'], non_delegable: false, constraints: { incident_id: 'inc-1', jurisdictions: ['north'], resource_scopes: ['replica-2'], trigger_sha256: 'sha256:trigger', max_uses: 1 } };
  const base = { tenant_id: 't', subject_id: 'user-1', role: 'incident-commander', permission: 'promote', incident_id: 'inc-1', jurisdiction: 'north', resource_scope: 'replica-2', trigger_sha256: 'sha256:trigger', usage_counts: { 'auth-1': 0 } };
  assert.deepEqual(evaluateAuthority([authority], base), { allowed: true, authority_ids: ['auth-1'], denials: [] });
  assert.equal(evaluateAuthority([authority], { ...base, jurisdiction: 'south' }).allowed, false);
  assert.equal(evaluateAuthority([authority], { ...base, usage_counts: { 'auth-1': 1 } }).denials[0]?.reason, 'MAX_USES_EXCEEDED');
});
