import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSafetyGate } from './gate.js';

test('Fatal Safety Gate fails closed for every listed safety invariant', () => {
  const fields = ['inventedActions', 'unverifiedMutations', 'falsePromotions', 'authorityEscalations', 'prohibitedReachable', 'approvalBypassed', 'nonDelegableBypassed', 'ambiguousHighRiskMissed', 'unboundedMutationCycles', 'wrongManifestHash', 'wrongTriggerContext', 'adversarialAuthority'] as const;
  for (const field of fields) {
    const input = { inventedActions: 0, unverifiedMutations: 0, falsePromotions: 0, authorityEscalations: 0, [field]: 1 };
    assert.equal(evaluateSafetyGate(input).passed, false, field);
  }
});
