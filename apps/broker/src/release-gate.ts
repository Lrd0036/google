import { createHash, constants, verify as verifySignature } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { Storage } from '@google-cloud/storage';
import { ReleaseAttestationSchema, type ReleaseAttestation } from '@runbook/types';
import { BrokerError, canonicalJson, type ReleaseMutationGate } from './broker.js';

const RISK_ORDER = ['R0_OBSERVE', 'R1_REVERSIBLE_LOW', 'R2_STATEFUL', 'R3_HIGH_IMPACT', 'R4_IRREVERSIBLE'] as const;

export interface ReleaseActivation {
  status: 'ACTIVE' | 'REVOKED';
  bucket: string;
  object: string;
  generation: string;
  sha256: string;
}

export interface AuditHealth {
  status: 'HEALTHY' | 'BACKLOG' | 'UNKNOWN';
  backlog: number;
  fresh_until: string;
}

export interface ActiveReleaseSource {
  loadActivation(): Promise<ReleaseActivation | undefined>;
  loadObject(activation: ReleaseActivation): Promise<Buffer>;
  loadAuditHealth(): Promise<AuditHealth | undefined>;
  loadPublicKey(keyId: string): Promise<string>;
}

export interface ExpectedReleaseIdentity {
  projectId: string;
  region: string;
  stateSchema: 'runtime/v1';
  imageDigests: Record<string, string>;
  terraformPlanSha256?: string;
  releaseKeyId: string;
}

function closed(message: string): never {
  throw new BrokerError('RELEASE_GATE_CLOSED', message, 503);
}

export function verifyActiveRelease(input: {
  bytes: Buffer;
  activation: ReleaseActivation;
  publicKey: string;
  expected: ExpectedReleaseIdentity;
  capability: string;
  manifestSha256: string;
  risk: string;
  auditHealth?: AuditHealth;
  now?: number;
}): ReleaseAttestation {
  const digest = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
  if (input.activation.status !== 'ACTIVE') closed('The release activation is revoked.');
  if (digest !== input.activation.sha256) closed('The activated release object digest does not match.');
  let json: unknown;
  try { json = JSON.parse(input.bytes.toString('utf8')); } catch { closed('The activated release object is not valid JSON.'); }
  const parsed = ReleaseAttestationSchema.safeParse(json);
  if (!parsed.success) closed('The activated release attestation does not satisfy its contract.');
  const attestation = parsed.data;
  if (attestation.signature.key_id !== input.expected.releaseKeyId) closed('The release attestation was signed by an unexpected key.');
  const unsigned = { ...attestation } as Record<string, unknown>;
  delete unsigned.signature;
  const signatureValid = verifySignature('sha256', Buffer.from(canonicalJson(unsigned)), {
    key: input.publicKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }, Buffer.from(attestation.signature.value, 'base64'));
  if (!signatureValid) closed('The release attestation signature is invalid.');

  const now = input.now ?? Date.now();
  if (Date.parse(attestation.issued_at) > now + 30_000 || Date.parse(attestation.expires_at) <= now) closed('The release attestation is not current.');
  if (!attestation.eligible || Object.values(attestation.gates).some((gate) => gate.status !== 'PASS')) closed('Not every release gate is passing.');
  if (attestation.project_id !== input.expected.projectId || attestation.region !== input.expected.region) closed('The release attestation targets a different environment.');
  if (attestation.release.state_schema !== input.expected.stateSchema) closed('The release attestation targets a different state schema.');
  if (input.expected.terraformPlanSha256 && attestation.release.terraform_plan_sha256 !== input.expected.terraformPlanSha256) closed('The Terraform plan identity does not match.');
  for (const [service, digestValue] of Object.entries(input.expected.imageDigests)) {
    if (attestation.release.image_digests[service] !== digestValue) closed(`The ${service} image identity does not match.`);
  }
  if (attestation.allowed_execution.manifest_sha256 !== input.manifestSha256) closed('The active release does not authorize this manifest.');
  if (!attestation.allowed_execution.capabilities.includes(input.capability)) closed('The active release does not authorize this capability.');
  if (RISK_ORDER.indexOf(input.risk as typeof RISK_ORDER[number]) > RISK_ORDER.indexOf(attestation.allowed_execution.maximum_risk)) closed('The capability exceeds the active release risk ceiling.');
  if (!input.auditHealth || input.auditHealth.status !== 'HEALTHY' || input.auditHealth.backlog !== 0 || Date.parse(input.auditHealth.fresh_until) <= now) {
    closed('Required audit delivery is unhealthy or stale.');
  }
  return attestation;
}

export class FirestoreGcsReleaseSource implements ActiveReleaseSource {
  private readonly storage = new Storage();
  private readonly kms = new KeyManagementServiceClient();
  constructor(private readonly firestore: Firestore) {}

  async loadActivation(): Promise<ReleaseActivation | undefined> {
    const snapshot = await this.firestore.doc('v1_release_state/controlled-cloud-reenable-v0.1').get();
    return snapshot.exists ? snapshot.data() as ReleaseActivation : undefined;
  }

  async loadObject(activation: ReleaseActivation): Promise<Buffer> {
    const [bytes] = await this.storage.bucket(activation.bucket).file(activation.object, { generation: Number(activation.generation) }).download();
    return bytes;
  }

  async loadAuditHealth(): Promise<AuditHealth | undefined> {
    const snapshot = await this.firestore.doc('v1_system_health/audit_delivery').get();
    return snapshot.exists ? snapshot.data() as AuditHealth : undefined;
  }

  async loadPublicKey(keyId: string): Promise<string> {
    const [key] = await this.kms.getPublicKey({ name: keyId });
    if (!key.pem) throw new Error('Release signing key has no public key material.');
    return key.pem;
  }
}

export class ActiveReleaseMutationGate implements ReleaseMutationGate {
  constructor(private readonly source: ActiveReleaseSource, private readonly expected: ExpectedReleaseIdentity) {}

  async authorize(input: { capability: string; manifestSha256: string; risk: string }): Promise<void> {
    try {
      const activation = await this.source.loadActivation();
      if (!activation) closed('No release attestation is active.');
      const [bytes, auditHealth, publicKey] = await Promise.all([
        this.source.loadObject(activation),
        this.source.loadAuditHealth(),
        this.source.loadPublicKey(this.expected.releaseKeyId),
      ]);
      verifyActiveRelease({ bytes, activation, auditHealth, publicKey, expected: this.expected, ...input });
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'RELEASE_GATE_CLOSED') throw error;
      closed('Release authority evidence could not be verified.');
    }
  }
}
