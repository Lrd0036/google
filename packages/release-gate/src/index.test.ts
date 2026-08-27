import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_RELEASE_GATES } from '@runbook/types';
import { evaluateRelease, type GateEvidence, type ReleaseDescriptor } from './index.js';

const sha = (value: string) => `sha256:${value.repeat(64)}`;
const descriptor: ReleaseDescriptor = {
  profile: 'controlled-cloud-reenable/v0.1', project_id: 'project', region: 'us-central1',
  release: { image_digests: { broker: sha('1') }, terraform_plan_sha256: sha('2'), state_schema: 'runtime/v1' },
  benchmark: { corpus_sha256: sha('3'), submission_sha256: sha('4'), report_sha256: sha('5') },
  allowed_execution: { manifest_sha256: sha('6'), capabilities: ['retry_job@1'], maximum_risk: 'R1_REVERSIBLE_LOW' },
};

function evidence(now: Date): GateEvidence[] {
  return REQUIRED_RELEASE_GATES.map((gate) => ({ gate, evidence_sha256: sha('a'), observed_at: now.toISOString(), fresh_until: new Date(now.getTime() + 60_000).toISOString(), checks: { verified: true } }));
}

test('evaluator derives eligible only when every required evidence check is current and true', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  assert.equal(evaluateRelease(descriptor, evidence(now), now).eligible, true);
  const missing = evidence(now).slice(1);
  const result = evaluateRelease(descriptor, missing, now);
  assert.equal(result.eligible, false);
  assert.equal(result.gates.corpus_provenance!.status, 'FAIL');
});

test('callers cannot self-certify with status fields', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const failed = evidence(now);
  failed[0] = { ...failed[0]!, checks: { verified: false, status: true } };
  assert.equal(evaluateRelease(descriptor, failed, now).eligible, false);
});
