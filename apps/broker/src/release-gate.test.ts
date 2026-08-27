import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from './broker.js';
import { verifyActiveRelease } from './release-gate.js';

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  const gate = { status: 'PASS', evidence_sha256: digest('e'), observed_at: new Date(now).toISOString() };
  const unsigned = {
    profile: 'controlled-cloud-reenable/v0.1',
    issued_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    project_id: 'test-project',
    region: 'us-central1',
    release: { image_digests: { 'rb-broker': digest('1') }, terraform_plan_sha256: digest('2'), state_schema: 'runtime/v1' },
    benchmark: { corpus_sha256: digest('3'), submission_sha256: digest('4'), report_sha256: digest('5') },
    allowed_execution: { manifest_sha256: digest('6'), capabilities: ['retry_job@1'], maximum_risk: 'R1_REVERSIBLE_LOW' },
    gates: Object.fromEntries(['corpus_provenance', 'annotations', 'benchmark', 'console', 'identity', 'authority', 'artifacts', 'audit', 'negative_security', 'backup_restore', 'alerting'].map((name) => [name, gate])),
    eligible: true,
    ...overrides,
  };
  const signature = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
  const bytes = Buffer.from(JSON.stringify({ ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'release-key', value: signature } }));
  return {
    input: {
      bytes,
      activation: { status: 'ACTIVE' as const, bucket: 'release', object: 'sha256/object', generation: '1', sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` },
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      expected: { projectId: 'test-project', region: 'us-central1', stateSchema: 'runtime/v1' as const, imageDigests: { 'rb-broker': digest('1') }, terraformPlanSha256: digest('2'), releaseKeyId: 'release-key' },
      capability: 'retry_job@1',
      manifestSha256: digest('6'),
      risk: 'R1_REVERSIBLE_LOW',
      auditHealth: { status: 'HEALTHY' as 'HEALTHY' | 'BACKLOG' | 'UNKNOWN', backlog: 0, fresh_until: new Date(now + 30_000).toISOString() },
      now,
    },
  };
}

test('active release verifies exact environment, capability, risk, signature, and audit health', () => {
  assert.equal(verifyActiveRelease(fixture().input).eligible, true);
});

test('stale audit delivery closes release authority', () => {
  const { input } = fixture();
  input.auditHealth = { status: 'BACKLOG', backlog: 1, fresh_until: new Date(input.now + 30_000).toISOString() };
  assert.throws(() => verifyActiveRelease(input), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'RELEASE_GATE_CLOSED');
});

test('wrong capability and artifact digest close release authority', () => {
  const capability = fixture().input;
  capability.capability = 'drain@1';
  assert.throws(() => verifyActiveRelease(capability), /does not authorize this capability/);
  const manifest = fixture().input;
  manifest.manifestSha256 = digest('9');
  assert.throws(() => verifyActiveRelease(manifest), /does not authorize this manifest/);
});

test('tampering with the stored attestation closes release authority', () => {
  const { input } = fixture();
  input.bytes = Buffer.from(input.bytes.toString('utf8').replace('test-project', 'other-project'));
  input.activation.sha256 = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
  assert.throws(() => verifyActiveRelease(input), /signature is invalid/);
});
