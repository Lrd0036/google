import { createHash, verify as verifySignature } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { ActionGrant, CapabilityDefinition, ExecutionLease } from '@runbook/types';
import { ActionGrantSchema, CapabilityManifestSchema } from '@runbook/types';
import { GoogleAuth } from 'google-auth-library';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class BrokerError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) {
    super(message);
    this.name = 'BrokerError';
  }
}

/** Stable JSON is used for digests and signatures; object insertion order is never trusted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}`;
}

/** Versioned and framed so distinct tuples cannot share a preimage. */
export function idempotencyKey(executionId: string, nodeId: string, operationGeneration: number): string {
  return `v2:${createHash('sha256').update(canonicalJson([executionId, nodeId, operationGeneration])).digest('hex')}`;
}

export interface GrantVerificationInput {
  grant: unknown;
  params: unknown;
  lease: ExecutionLease;
  controlEpoch: number;
  publicKey: string | Buffer;
  now?: number;
  expectedKeyId?: string;
  expectedIssuer?: string;
  expectedAudience?: string;
  expectedRunbookIrSha256?: string;
  expectedTriggerSha256?: string;
}

export function verifyActionGrant(input: GrantVerificationInput): ActionGrant {
  const parsed = ActionGrantSchema.safeParse(input.grant);
  if (!parsed.success) throw new BrokerError('INVALID_GRANT', 'Action Grant does not satisfy its contract.');
  const grant = parsed.data;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (grant.iat > now + 30 || grant.exp <= now) throw new BrokerError('GRANT_EXPIRED', 'Action Grant is outside its validity window.');
  if (grant.iss !== (input.expectedIssuer ?? 'rb-control')) throw new BrokerError('UNTRUSTED_ISSUER', 'Action Grant issuer is not trusted.');
  if (grant.aud !== (input.expectedAudience ?? 'rb-broker')) throw new BrokerError('WRONG_AUDIENCE', 'Action Grant audience is not this broker.');
  if (input.expectedRunbookIrSha256 && grant.runbook_ir_sha256 !== input.expectedRunbookIrSha256) throw new BrokerError('RUNBOOK_MISMATCH', 'Action Grant is for a different runbook artifact.');
  if (input.expectedTriggerSha256 && grant.trigger_sha256 !== input.expectedTriggerSha256) throw new BrokerError('TRIGGER_MISMATCH', 'Action Grant is for a different trigger.');
  if (grant.lease_generation !== input.lease.generation) throw new BrokerError('STALE_LEASE', 'Action Grant lease generation is stale.');
  if (grant.control_epoch !== input.controlEpoch) throw new BrokerError('STALE_CONTROL_EPOCH', 'Action Grant control epoch is stale.');
  const leaseExpiry = Date.parse(input.lease.expires_at);
  if (!Number.isFinite(leaseExpiry) || leaseExpiry <= now * 1000) throw new BrokerError('STALE_LEASE', 'Action Grant lease is expired or invalid.');
  if (grant.params_sha256 !== sha256(input.params)) throw new BrokerError('PARAMETER_DIGEST_MISMATCH', 'Action parameters do not match the grant digest.');
  if (input.expectedKeyId && grant.signature.key_id !== input.expectedKeyId) throw new BrokerError('UNKNOWN_SIGNING_KEY', 'Action Grant signing key is not trusted.');

  const unsigned = { ...grant } as Record<string, unknown>;
  delete unsigned.signature;
  const signature = Buffer.from(grant.signature.value, 'base64');
  const algorithm = grant.signature.algorithm === 'RSA-PSS-SHA256' ? 'RSA-PSS' : 'ECDSA';
  const valid = verifySignature('sha256', Buffer.from(canonicalJson(unsigned)), {
    key: input.publicKey,
    padding: algorithm === 'RSA-PSS' ? 6 : undefined,
    saltLength: algorithm === 'RSA-PSS' ? 32 : undefined,
  }, signature);
  if (!valid) throw new BrokerError('INVALID_SIGNATURE', 'Action Grant signature verification failed.');
  return grant;
}

export interface OperationRecord {
  key_hash: string;
  execution_id: string;
  node_id: string;
  operation_generation: number;
  capability: string;
  params_sha256: string;
  status: 'IN_FLIGHT' | 'COMPLETED' | 'FAILED' | 'UNCERTAIN';
  reconcile_capability?: string;
  response?: unknown;
  external_operation_id?: string;
}
export interface OperationStore {
  get(keyHash: string): Promise<OperationRecord | undefined>;
  createIfAbsent(record: OperationRecord): Promise<boolean>;
  complete(keyHash: string, status: OperationRecord['status'], response?: unknown): Promise<void>;
}

export interface GrantReplayStore {
  consume(jti: string, expiresAt: number): Promise<boolean>;
}

export interface ExecutionFenceRecord {
  status?: string;
  control_epoch?: number;
  lease?: { holder?: string; generation?: number; expires_at?: string };
  runbook?: { ir_sha256?: string; manifest_sha256?: string };
  trigger?: { sha256?: string };
}

export interface ExecutionFenceStore {
  get(executionId: string): Promise<ExecutionFenceRecord | undefined>;
}

/** In-memory replay protection for local development. Production should persist this atomically. */
export class MemoryGrantReplayStore implements GrantReplayStore {
  private readonly consumed = new Map<string, number>();

  async consume(jti: string, expiresAt: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, expiry] of this.consumed) if (expiry <= now) this.consumed.delete(key);
    if (this.consumed.has(jti)) return false;
    this.consumed.set(jti, expiresAt);
    return true;
  }
}

/** Firestore-backed single-use grant consumption for local emulators and production wiring. */
export class FirestoreGrantReplayStore implements GrantReplayStore {
  public constructor(private readonly firestore: Firestore, private readonly collection = 'grant_replays') {}
  async consume(jti: string, expiresAt: number): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.firestore.doc(`${this.collection}/${encodeURIComponent(jti)}`);
      const existing = await transaction.get(ref);
      if (existing.exists) return false;
      transaction.create(ref, { jti, expires_at: expiresAt, consumed_at: new Date().toISOString() });
      return true;
    });
  }
}

export class MemoryOperationStore implements OperationStore {
  private readonly records = new Map<string, OperationRecord>();
  async get(keyHash: string) { return this.records.get(keyHash); }
  async createIfAbsent(record: OperationRecord) { if (this.records.has(record.key_hash)) return false; this.records.set(record.key_hash, record); return true; }
  async complete(keyHash: string, status: OperationRecord['status'], response?: unknown) {
    const record = this.records.get(keyHash);
    if (record) this.records.set(keyHash, { ...record, status, response });
  }
}

/** Durable operation ledger. The transaction makes createIfAbsent safe across broker instances. */
export class FirestoreOperationStore implements OperationStore {
  public constructor(private readonly firestore: Firestore, private readonly collection = 'operations') {}
  private ref(keyHash: string) { return this.firestore.doc(`${this.collection}/${encodeURIComponent(keyHash)}`); }
  async get(keyHash: string): Promise<OperationRecord | undefined> {
    const snapshot = await this.ref(keyHash).get();
    return snapshot.exists ? snapshot.data() as OperationRecord : undefined;
  }
  async createIfAbsent(record: OperationRecord): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const ref = this.ref(record.key_hash);
      const existing = await transaction.get(ref);
      if (existing.exists) return false;
      const data: Record<string, unknown> = { ...record, created_at: new Date().toISOString() };
      for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
      transaction.create(ref, data);
      return true;
    });
  }
  async complete(keyHash: string, status: OperationRecord['status'], response?: unknown): Promise<void> {
    await this.ref(keyHash).set({ status, response, completed_at: new Date().toISOString() }, { merge: true });
  }
}

/** Reads current Control-owned fencing state. Cloud dispatch must use this, never request-carried copies alone. */
export class FirestoreExecutionFenceStore implements ExecutionFenceStore {
  public constructor(private readonly firestore: Firestore) {}
  async get(executionId: string): Promise<ExecutionFenceRecord | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:%+@-]{0,255}$/.test(executionId)) throw new BrokerError('INVALID_EXECUTION_ID', 'Execution ID is not a valid Firestore document identifier.');
    const snapshot = await this.firestore.collection('executions').doc(executionId).get();
    return snapshot.exists ? snapshot.data() as ExecutionFenceRecord : undefined;
  }
}

export class CircuitBreaker {
  private failures = 0;
  private open = false;
  constructor(private readonly threshold = 3) {}
  isOpen() { return this.open; }
  recordViolation() { this.failures += 1; if (this.failures >= this.threshold) this.open = true; }
  recordSuccess() { this.failures = 0; }
}

/** Small dependency-free metrics surface for local runs and Prometheus scraping. */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  increment(name: string, amount = 1): void { this.counters.set(name, (this.counters.get(name) ?? 0) + amount); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.counters); }
  prometheus(): string { return [...this.counters.entries()].map(([name, value]) => `runbook_${name} ${value}`).join('\n') + '\n'; }
}

function validateSchema(value: unknown, schema: Record<string, unknown>, path = '$'): string | undefined {
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) return `${path} has an invalid value`;
  if (schema.type === 'string' && typeof value !== 'string') return `${path} must be a string`;
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return `${path} must be a number`;
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) return `${path} must be an integer`;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path} must be a boolean`;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.items) for (const [index, item] of value.entries()) { const error = validateSchema(item, schema.items as Record<string, unknown>, `${path}[${index}]`); if (error) return error; }
    return undefined;
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
    const object = value as Record<string, unknown>;
    for (const required of (schema.required as string[] | undefined) ?? []) if (!(required in object)) return `${path}.${required} is required`;
    if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!(schema.properties as Record<string, unknown> | undefined)?.[key]) return `${path}.${key} is not allowed`;
    for (const [key, child] of Object.entries((schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {})) if (key in object) { const error = validateSchema(object[key], child, `${path}.${key}`); if (error) return error; }
  }
  return undefined;
}

export interface DispatchRequest extends GrantVerificationInput {
  params: Json;
  manifest: unknown;
  operationGeneration?: number;
  store: OperationStore;
  replayStore?: GrantReplayStore;
  fenceStore?: ExecutionFenceStore;
  allowRequestCarriedFence?: boolean;
  allowedOrigins: readonly string[];
  fetchImpl?: typeof fetch;
  circuitBreaker?: CircuitBreaker;
  metrics?: MetricsRegistry;
}

function verifyOperationTuple(record: OperationRecord, executionId: string, nodeId: string, operationGeneration: number): void {
  if (record.execution_id !== executionId || record.node_id !== nodeId || record.operation_generation !== operationGeneration) {
    throw new BrokerError('IDEMPOTENCY_RECORD_MISMATCH', 'Stored operation identity does not match this dispatch.', 409);
  }
}

function verifyOperationIdentity(record: OperationRecord, executionId: string, nodeId: string, operationGeneration: number, capability: string, paramsSha256: string): void {
  verifyOperationTuple(record, executionId, nodeId, operationGeneration);
  if (record.capability !== capability || record.params_sha256 !== paramsSha256) throw new BrokerError('IDEMPOTENCY_RECORD_MISMATCH', 'Stored operation identity does not match this dispatch.', 409);
}

async function verifyExecutionFence(input: DispatchRequest, grant: ActionGrant, now = Date.now()): Promise<void> {
  if (!input.fenceStore) {
    if (input.allowRequestCarriedFence === true) return;
    throw new BrokerError('AUTHORITATIVE_FENCE_REQUIRED', 'Authoritative execution fencing is required.', 503);
  }
  const current = await input.fenceStore.get(grant.execution_id);
  if (!current || current.status !== 'RUNNING') throw new BrokerError('EXECUTION_NOT_RUNNABLE', 'Execution is not in a runnable state.', 409);
  if (!current.lease || current.lease.generation !== grant.lease_generation) throw new BrokerError('STALE_LEASE', 'Execution lease generation is no longer current.', 409);
  const expiresAt = Date.parse(current.lease.expires_at ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new BrokerError('STALE_LEASE', 'Execution lease is expired or invalid.', 409);
  if (current.control_epoch !== grant.control_epoch) throw new BrokerError('STALE_CONTROL_EPOCH', 'Execution control epoch is no longer current.', 409);
  if (current.runbook?.ir_sha256 !== grant.runbook_ir_sha256 || current.runbook?.manifest_sha256 !== grant.manifest_sha256) {
    throw new BrokerError('EXECUTION_ARTIFACT_MISMATCH', 'Execution artifacts do not match the Action Grant.', 409);
  }
  if (current.trigger?.sha256 && current.trigger.sha256 !== grant.trigger_sha256) throw new BrokerError('TRIGGER_MISMATCH', 'Execution trigger does not match the Action Grant.', 409);
}

export async function dispatchActionGrant(input: DispatchRequest): Promise<{ operation_id?: string; status: string; response?: unknown; idempotency_key: string }> {
  input.metrics?.increment('action_dispatched_total');
  const grant = verifyActionGrant(input);
  const manifestResult = CapabilityManifestSchema.safeParse(input.manifest);
  if (!manifestResult.success) throw new BrokerError('INVALID_MANIFEST', 'Capability manifest does not satisfy its contract.');
  if (grant.manifest_sha256 !== sha256(input.manifest)) throw new BrokerError('RUNTIME_MANIFEST_MISMATCH', 'Active capability manifest does not match the Action Grant.');
  const [capabilityId, capabilityVersion] = grant.capability.split('@');
  const capability = manifestResult.data.capabilities.find((candidate) => candidate.id === capabilityId && candidate.version === Number(capabilityVersion));
  if (!capability) throw new BrokerError('CAPABILITY_NOT_DECLARED', `Capability ${grant.capability} is not declared by the manifest.`);
  await verifyExecutionFence(input, grant);
  if (input.replayStore && !(await input.replayStore.consume(grant.jti, grant.exp))) { input.metrics?.increment('grant_replay_rejected_total'); throw new BrokerError('GRANT_REPLAYED', 'Action Grant jti has already been consumed.'); }
  const inputError = validateSchema(input.params, capability.input_schema);
  if (inputError) throw new BrokerError('INPUT_SCHEMA_VIOLATION', inputError);
  if (input.circuitBreaker?.isOpen()) { input.metrics?.increment('capability_circuit_open_total'); throw new BrokerError('CIRCUIT_OPEN', 'Capability circuit breaker is open.', 503); }
  const operationGeneration = input.operationGeneration ?? 0;
  const key = idempotencyKey(grant.execution_id, grant.node_id, operationGeneration);
  const existing = await input.store.get(key);
  if (existing && existing.status === 'UNCERTAIN' && existing.reconcile_capability === grant.capability) {
    verifyOperationTuple(existing, grant.execution_id, grant.node_id, operationGeneration);
    const response = await invoke(capability, input.params, key, input.allowedOrigins, input.fetchImpl ?? fetch);
    const outputError = validateSchema(response, capability.output_schema);
    if (outputError) throw new BrokerError('RECONCILIATION_SCHEMA_VIOLATION', outputError, 502);
    const reconciled = typeof response === 'object' && response !== null && (response as Record<string, unknown>).status === 'COMPLETED';
    if (!reconciled) throw new BrokerError('RECONCILIATION_INCONCLUSIVE', 'Reconciliation did not prove completion; the operation remains uncertain.', 503);
    await input.store.complete(key, 'COMPLETED', response);
    input.metrics?.increment('action_reconciled_total');
    return { status: 'RECONCILED', response, idempotency_key: key };
  }
  if (existing) verifyOperationIdentity(existing, grant.execution_id, grant.node_id, operationGeneration, grant.capability, grant.params_sha256);
  if (existing) return { status: existing.status, response: existing.response, idempotency_key: key };
  if (!(await input.store.createIfAbsent({ key_hash: key, execution_id: grant.execution_id, node_id: grant.node_id, operation_generation: operationGeneration, capability: grant.capability, params_sha256: grant.params_sha256, status: 'IN_FLIGHT', reconcile_capability: capability.idempotency.reconcile_capability }))) {
    const raced = await input.store.get(key);
    if (raced) verifyOperationIdentity(raced, grant.execution_id, grant.node_id, operationGeneration, grant.capability, grant.params_sha256);
    return { status: raced?.status ?? 'IN_FLIGHT', response: raced?.response, idempotency_key: key };
  }
  try {
    const response = await invoke(capability, input.params, key, input.allowedOrigins, input.fetchImpl ?? fetch);
    const outputError = validateSchema(response, capability.output_schema);
    if (outputError) {
      input.metrics?.increment('capability_schema_violation_total');
      input.circuitBreaker?.recordViolation();
      throw new BrokerError('OUTPUT_SCHEMA_VIOLATION', outputError, 502);
    }
    input.circuitBreaker?.recordSuccess();
    input.metrics?.increment('action_completed_total');
    await input.store.complete(key, 'COMPLETED', response);
    return { status: 'COMPLETED', operation_id: typeof response === 'object' && response !== null && 'operation_id' in response ? String((response as Record<string, unknown>).operation_id) : undefined, response, idempotency_key: key };
  } catch (error) {
    const transportUncertain = error instanceof Error && (error.name === 'AbortError' || error.name === 'TypeError');
    if (transportUncertain && capability.idempotency.strategy === 'RECONCILABLE') {
      input.metrics?.increment('action_uncertain_total');
      await input.store.complete(key, 'UNCERTAIN', { error: 'REMOTE_OUTCOME_UNKNOWN', reconcile_capability: capability.idempotency.reconcile_capability });
      throw new BrokerError('OPERATION_UNCERTAIN', 'Capability outcome is unknown; reconcile the recorded operation before any retry.', 503);
    }
    input.metrics?.increment('action_failed_total');
    await input.store.complete(key, 'FAILED', { error: error instanceof Error ? error.message : 'Capability invocation failed' });
    throw error;
  }
}

function normalizedAllowedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const value of origins) {
    try { normalized.add(new URL(value).origin); } catch { throw new BrokerError('INVALID_DESTINATION_POLICY', 'Broker destination policy contains an invalid origin.', 503); }
  }
  if (normalized.size === 0) throw new BrokerError('DESTINATION_POLICY_MISSING', 'Broker has no allowed capability origins configured.', 503);
  return normalized;
}

export function resolveCapabilityUrl(capability: CapabilityDefinition, params: Json, allowedOrigins: readonly string[], localTransport = process.env.LOCAL_TRANSPORT === 'true'): URL {
  if (capability.transport.type !== 'HTTP' || !capability.transport.allowed_host || !capability.transport.path) throw new BrokerError('UNSUPPORTED_TRANSPORT', 'Only HTTP capabilities with an allowed host are supported.', 501);
  if (!capability.transport.path.startsWith('/') || capability.transport.path.startsWith('//')) throw new BrokerError('INVALID_CAPABILITY_PATH', 'Capability transport path must be origin-relative.');
  const path = capability.transport.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = (params as Record<string, Json>)[name];
    if (value === undefined || typeof value === 'object') throw new BrokerError('INPUT_SCHEMA_VIOLATION', `Path parameter '${name}' is missing or not scalar.`);
    return encodeURIComponent(String(value));
  });
  const scheme = localTransport ? 'http' : 'https';
  const base = new URL(`${scheme}://${capability.transport.allowed_host}`);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !normalizedAllowedOrigins(allowedOrigins).has(url.origin)) throw new BrokerError('DESTINATION_NOT_ALLOWED', 'Capability destination is not allowed.');
  return url;
}

async function invoke(capability: CapabilityDefinition, params: Json, key: string, allowedOrigins: readonly string[], fetchImpl: typeof fetch): Promise<unknown> {
  const url = resolveCapabilityUrl(capability, params, allowedOrigins);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), capability.timeout_ms);
  try {
    const method = capability.transport.method ?? 'POST';
    let identityHeaders = {};
    if (process.env.GCP_SERVICE_AUTH === 'true') {
      if (!capability.transport.audience) throw new BrokerError('CAPABILITY_AUDIENCE_REQUIRED', 'Authenticated capability transport requires an audience.');
      let audienceOrigin: string;
      try { audienceOrigin = new URL(capability.transport.audience).origin; } catch { throw new BrokerError('INVALID_CAPABILITY_AUDIENCE', 'Capability audience is invalid.'); }
      if (audienceOrigin !== url.origin) throw new BrokerError('CAPABILITY_AUDIENCE_MISMATCH', 'Capability audience does not match its allowed destination.');
      identityHeaders = await new GoogleAuth().getIdTokenClient(url.origin).then((client) => client.getRequestHeaders(url.toString()));
    }
    const response = await fetchImpl(url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...identityHeaders, ...(capability.idempotency.header ? { [capability.idempotency.header]: key } : {}) }, ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(params) }), signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new BrokerError('CAPABILITY_REDIRECT_REJECTED', 'Capability redirects are not allowed.', 502);
    const body = await response.json() as unknown;
    if (!response.ok) throw new BrokerError('CAPABILITY_ERROR', `Capability returned HTTP ${response.status}.`, 502);
    return body;
  } finally { clearTimeout(timeout); }
}
