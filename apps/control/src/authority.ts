import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { ApprovalAssertionSchema, type ApprovalAssertion } from '@runbook/types';

export interface ApprovalContext {
  issuer?: string;
  audience?: string;
  tenant_id: string;
  authority_id: string;
  execution_id: string;
  runbook_ir_sha256: string;
  node_id: string;
  trigger_sha256: string;
  target_scope_sha256: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function digest(value: unknown): string { return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`; }

export function issueApprovalAssertion(context: ApprovalContext, principal: string, decision: ApprovalAssertion['decision'], privateKey: KeyObject, ttlSeconds = 300, now = Math.floor(Date.now() / 1000)): ApprovalAssertion {
  const unsigned = { typ: 'RB-APPROVAL-ASSERTION' as const, version: '0.1' as const, iss: context.issuer ?? 'rb-authority-local', sub: principal, aud: context.audience ?? 'rb-control', iat: now, exp: now + ttlSeconds, jti: `approval-${now}-${digest(`${principal}:${context.execution_id}:${context.node_id}`).slice(-16)}`, tenant_id: context.tenant_id, authority_id: context.authority_id, execution_id: context.execution_id, runbook_ir_sha256: context.runbook_ir_sha256, node_id: context.node_id, trigger_sha256: context.trigger_sha256, target_scope_sha256: context.target_scope_sha256, decision };
  const value = sign('sha256', Buffer.from(canonicalJson(unsigned)), { key: privateKey, padding: 6, saltLength: 32 }).toString('base64');
  return ApprovalAssertionSchema.parse({ ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', value } });
}

export function verifyApprovalAssertion(assertion: unknown, publicKey: string | Buffer | KeyObject, expected: ApprovalContext & { principal?: string; decision?: ApprovalAssertion['decision'] }, now = Math.floor(Date.now() / 1000)): ApprovalAssertion {
  const parsed = ApprovalAssertionSchema.safeParse(assertion);
  if (!parsed.success) throw new Error('INVALID_APPROVAL_ASSERTION');
  const value = parsed.data;
  if (value.exp <= now || value.iat > now + 30) throw new Error('APPROVAL_ASSERTION_EXPIRED');
  if (expected.issuer && value.iss !== expected.issuer || expected.audience && value.aud !== expected.audience || expected.principal && value.sub !== expected.principal || expected.decision && value.decision !== expected.decision) throw new Error('APPROVAL_ASSERTION_CONTEXT_MISMATCH');
  for (const key of ['tenant_id', 'authority_id', 'execution_id', 'runbook_ir_sha256', 'node_id', 'trigger_sha256', 'target_scope_sha256'] as const) if (value[key] !== expected[key]) throw new Error('APPROVAL_ASSERTION_CONTEXT_MISMATCH');
  const { signature, ...unsigned } = value;
  const verificationKey = typeof publicKey === 'string' || Buffer.isBuffer(publicKey) ? createPublicKey(publicKey) : publicKey;
  if (!verify('sha256', Buffer.from(canonicalJson(unsigned)), { key: verificationKey, padding: 6, saltLength: 32 }, Buffer.from(signature.value, 'base64'))) throw new Error('INVALID_APPROVAL_SIGNATURE');
  return value;
}

export class MemoryApprovalReplayStore {
  private readonly consumed = new Set<string>();
  consume(assertion: ApprovalAssertion): boolean {
    if (this.consumed.has(assertion.jti)) return false;
    this.consumed.add(assertion.jti);
    return true;
  }
}

export class FirestoreApprovalReplayStore {
  constructor(private readonly firestore: Firestore) {}
  async consume(assertion: ApprovalAssertion): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.firestore.doc(`v1_approval_replays/${encodeURIComponent(assertion.jti)}`);
      const existing = await transaction.get(ref);
      if (existing.exists) return false;
      transaction.create(ref, { jti: assertion.jti, expires_at: assertion.exp, consumed_at: new Date().toISOString() });
      return true;
    });
  }
}
