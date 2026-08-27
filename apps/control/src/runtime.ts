import { createHash } from 'node:crypto';
import type { DocumentReference, Firestore, Transaction } from '@google-cloud/firestore';
import { RBIRDocumentSchema, type RBIRDocument, type RBIRNode, type RBIREdge } from '@runbook/types';

export const DEFAULT_LEASE_TTL_MS = 30_000;
export const DEFAULT_CLAIM_GRACE_MS = 5_000;
const FIRESTORE_DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:%+@-]{0,255}$/;

export function requireFirestoreDocumentId(value: unknown, label = 'document id'): string {
  if (typeof value !== 'string' || !FIRESTORE_DOCUMENT_ID.test(value)) throw new Error(`INVALID_${label.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_')}`);
  return value;
}

export type RuntimeStatus = 'PENDING' | 'RUNNING' | 'SUSPENDED_APPROVAL' | 'COMPLETED' | 'HALTED' | 'FAILED';

export interface Lease {
  holder: string;
  generation: number;
  acquired_at: string;
  expires_at: string;
  last_heartbeat_at: string;
}

export interface Cursor {
  active_tokens: Record<string, { node_id: string; node_attempt: number }>;
  state_version: number;
}

export interface PendingApproval {
  approval_id: string;
  node_id: string;
  allowed_decisions: string[];
  authority_requirement_ids: string[];
  quorum: number;
  approvers: string[];
  expires_at?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}

export interface ExecutionDocument {
  execution_id: string;
  tenant_id: string;
  status: RuntimeStatus;
  runbook: { id: string; version: number; ir_sha256: string; manifest_sha256: string };
  runbook_document?: RBIRDocument;
  trigger?: { event_id: string; sha256: string; target_scope: string };
  cursor: Cursor;
  control_epoch?: number;
  lease?: Lease;
  pending_approval?: PendingApproval | null;
  last_event_sequence: number;
  last_event_hash: string;
  context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RuntimeEvent {
  sequence: number;
  event_id: string;
  type: string;
  node_id?: string;
  node_attempt?: number;
  payload?: Record<string, unknown>;
  actor: { principal: string; authority_ids: string[] };
  previous_event_hash: string;
  event_hash: string;
  timestamp: string;
}

export interface ApprovalIngestion {
  approval_id: string;
  execution_id: string;
  node_id: string;
  decision: 'APPROVE' | 'REJECT';
  principal: string;
  authority_ids?: string[];
  state_version?: number;
}

export class StaleExecutionLeaseError extends Error {
  public readonly code = 'STALE_EXECUTION_LEASE';
  public constructor(message = 'The execution lease is stale or is held by another worker') {
    super(message);
    this.name = 'StaleExecutionLeaseError';
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function hashEvent(event: Omit<RuntimeEvent, 'event_hash'>): string {
  const { previous_event_hash: previousHash, ...eventWithoutHashes } = event;
  return sha256(`${canonicalJson(eventWithoutHashes)}${previousHash}`);
}

export function initialEventHash(execution: Pick<ExecutionDocument, 'execution_id' | 'tenant_id' | 'runbook' | 'created_at'>): string {
  return sha256(canonicalJson({ execution_id: execution.execution_id, tenant_id: execution.tenant_id, runbook: execution.runbook, created_at: execution.created_at }));
}

export function verifyEventChain(executionHeaderHash: string, events: RuntimeEvent[]): boolean {
  let previous = executionHeaderHash;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const { event_hash: _eventHash, ...eventWithoutHash } = event;
    if (event.previous_event_hash !== previous || hashEvent(eventWithoutHash) !== event.event_hash) return false;
    previous = event.event_hash;
  }
  return true;
}

export function appendEvent(execution: ExecutionDocument, input: Omit<RuntimeEvent, 'sequence' | 'event_id' | 'previous_event_hash' | 'event_hash' | 'timestamp'>, now = new Date()): RuntimeEvent {
  const event: Omit<RuntimeEvent, 'event_hash'> = {
    ...input,
    sequence: execution.last_event_sequence + 1,
    event_id: `event-${execution.last_event_sequence + 1}`,
    previous_event_hash: execution.last_event_hash,
    timestamp: now.toISOString(),
  };
  return { ...event, event_hash: hashEvent(event) };
}

export function findTransition(document: RBIRDocument, node: RBIRNode, outcome: string): RBIREdge {
  if (!node.outcomes.includes(outcome)) throw new Error(`Outcome ${outcome} is not declared by node ${node.id}`);
  const matches = document.edges.filter((edge) => edge.from === node.id && edge.on === outcome);
  if (matches.length !== 1) throw new Error(`Expected exactly one compiled transition for ${node.id}:${outcome}`);
  return matches[0]!;
}

export function advanceDeterministically(document: RBIRDocument, nodeId: string, outcome: string): { node: RBIRNode; nextNodeId: string; edge: RBIREdge } {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown RBIR node ${nodeId}`);
  const edge = findTransition(document, node, outcome);
  return { node, nextNodeId: edge.to, edge };
}

export interface FirestoreStateStore {
  executionRef(executionId: string): DocumentReference<ExecutionDocument>;
  eventRef(executionId: string, sequence: number): DocumentReference<RuntimeEvent>;
  approvalRef(executionId: string, approvalId: string): DocumentReference<Record<string, unknown>>;
  outboxRef(executionId: string, sequence: number): DocumentReference<Record<string, unknown>>;
  runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T>;
}

export class FirestoreExecutionStore implements FirestoreStateStore {
  public constructor(private readonly firestore: Firestore, private readonly collection = 'executions') {}
  public executionRef(executionId: string): DocumentReference<ExecutionDocument> {
    return this.firestore.collection(this.collection).doc(requireFirestoreDocumentId(executionId, 'execution id')) as DocumentReference<ExecutionDocument>;
  }
  public eventRef(executionId: string, sequence: number): DocumentReference<RuntimeEvent> {
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error('INVALID_EVENT_SEQUENCE');
    return this.executionRef(executionId).collection('events').doc(String(sequence)) as DocumentReference<RuntimeEvent>;
  }
  public approvalRef(executionId: string, approvalId: string): DocumentReference<Record<string, unknown>> {
    return this.executionRef(executionId).collection('approvals').doc(requireFirestoreDocumentId(approvalId, 'approval record id'));
  }
  public outboxRef(executionId: string, sequence: number): DocumentReference<Record<string, unknown>> {
    return this.firestore.doc(`v1_audit_outbox/${requireFirestoreDocumentId(executionId, 'execution id')}:${sequence}`);
  }
  public runTransaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(callback);
  }
}

export class ExecutionController {
  public constructor(
    private readonly store: FirestoreStateStore,
    private readonly leaseTtlMs = DEFAULT_LEASE_TTL_MS,
    private readonly claimGraceMs = DEFAULT_CLAIM_GRACE_MS,
  ) {}

  public acquireLease(executionId: string, workerId: string, now = new Date()): Promise<Lease> {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.executionRef(executionId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new Error(`Execution ${executionId} not found`);
      const execution = snapshot.data()!;
      const current = execution.lease;
      const reclaimable = !current || now.getTime() > Date.parse(current.expires_at) + this.claimGraceMs;
      if (!reclaimable) throw new Error('EXECUTION_LEASE_BUSY');
      const lease: Lease = { holder: workerId, generation: (current?.generation ?? 0) + 1, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + this.leaseTtlMs).toISOString(), last_heartbeat_at: now.toISOString() };
      tx.update(ref, { lease, updated_at: now.toISOString() });
      return lease;
    });
  }

  public heartbeat(executionId: string, workerId: string, generation: number, now = new Date()): Promise<Lease> {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.executionRef(executionId);
      const snapshot = await tx.get(ref);
      const execution = snapshot.data();
      if (!execution?.lease || execution.lease.holder !== workerId || execution.lease.generation !== generation || now.getTime() > Date.parse(execution.lease.expires_at)) throw new StaleExecutionLeaseError();
      const lease = { ...execution.lease, last_heartbeat_at: now.toISOString(), expires_at: new Date(now.getTime() + this.leaseTtlMs).toISOString() };
      tx.update(ref, { lease, updated_at: now.toISOString() });
      return lease;
    });
  }

  public transition(executionId: string, workerId: string, generation: number, outcome: string, now = new Date()): Promise<ExecutionDocument> {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.executionRef(executionId);
      const snapshot = await tx.get(ref);
      const execution = snapshot.data();
      if (!execution?.lease || execution.lease.holder !== workerId || execution.lease.generation !== generation || now.getTime() >= Date.parse(execution.lease.expires_at)) throw new StaleExecutionLeaseError();
      if (!execution.runbook_document) throw new Error('TRUSTED_RUNBOOK_DOCUMENT_REQUIRED');
      const document = RBIRDocumentSchema.parse(execution.runbook_document);
      const token = execution.cursor.active_tokens.main;
      if (!token) throw new Error('EXECUTION_CURSOR_EMPTY');
      const result = advanceDeterministically(document, token.node_id, outcome);
      const nextNode = document.nodes.find((node) => node.id === result.nextNodeId)!;
      const status: RuntimeStatus = nextNode.kind === 'TERMINAL' ? (nextNode.terminal?.status === 'RESOLVED' ? 'COMPLETED' : 'HALTED') : nextNode.kind === 'HUMAN_APPROVAL' ? 'SUSPENDED_APPROVAL' : 'RUNNING';
      const pendingApproval = nextNode.kind === 'HUMAN_APPROVAL' ? { approval_id: `apr_${executionId}_${execution.cursor.state_version + 1}`, node_id: nextNode.id, allowed_decisions: ['APPROVE', 'REJECT'], authority_requirement_ids: nextNode.approval ? [nextNode.approval.role] : [], quorum: nextNode.approval?.quorum ?? 1, approvers: [], expires_at: nextNode.approval?.timeout_ms ? new Date(now.getTime() + nextNode.approval.timeout_ms).toISOString() : undefined, status: 'PENDING' as const } : null;
      const event = appendEvent(execution, { type: 'NODE_TRANSITIONED', node_id: token.node_id, node_attempt: token.node_attempt, payload: { outcome, to: result.nextNodeId, edge_id: result.edge.id }, actor: { principal: workerId, authority_ids: [] } }, now);
      const updated: ExecutionDocument = { ...execution, status, pending_approval: pendingApproval, cursor: { active_tokens: { main: { node_id: result.nextNodeId, node_attempt: 1 } }, state_version: execution.cursor.state_version + 1 }, last_event_sequence: event.sequence, last_event_hash: event.event_hash, updated_at: now.toISOString() };
      tx.update(ref, updated as unknown as Record<string, unknown>);
      tx.create(this.store.eventRef(executionId, event.sequence), event);
      tx.create(this.store.outboxRef(executionId, event.sequence), { execution_id: executionId, sequence: event.sequence, event, status: 'PENDING', created_at: now.toISOString() });
      return updated;
    });
  }

  public suspendForApproval(executionId: string, workerId: string, generation: number, approval: PendingApproval, now = new Date()): Promise<ExecutionDocument> {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.executionRef(executionId);
      const snapshot = await tx.get(ref);
      const execution = snapshot.data();
      if (!execution?.lease || execution.lease.holder !== workerId || execution.lease.generation !== generation || now.getTime() >= Date.parse(execution.lease.expires_at)) throw new StaleExecutionLeaseError();
      const event = appendEvent(execution, { type: 'APPROVAL_SUSPENDED', node_id: approval.node_id, actor: { principal: workerId, authority_ids: approval.authority_requirement_ids } }, now);
      const updated = { ...execution, status: 'SUSPENDED_APPROVAL' as const, pending_approval: approval, cursor: { ...execution.cursor, state_version: execution.cursor.state_version + 1 }, last_event_sequence: event.sequence, last_event_hash: event.event_hash, updated_at: now.toISOString() };
      tx.update(ref, updated);
      tx.create(this.store.eventRef(executionId, event.sequence), event);
      tx.create(this.store.outboxRef(executionId, event.sequence), { execution_id: executionId, sequence: event.sequence, event, status: 'PENDING', created_at: now.toISOString() });
      return updated;
    });
  }

  public ingestApproval(input: ApprovalIngestion, now = new Date()): Promise<ExecutionDocument> {
    return this.store.runTransaction(async (tx) => {
      const ref = this.store.executionRef(input.execution_id);
      const snapshot = await tx.get(ref);
      const execution = snapshot.data();
      if (!execution) throw new Error(`Execution ${input.execution_id} not found`);
      if (execution.status !== 'SUSPENDED_APPROVAL' || execution.pending_approval?.approval_id !== input.approval_id || execution.pending_approval.node_id !== input.node_id) throw new Error('APPROVAL_NOT_PENDING');
      if (execution.pending_approval.expires_at && Date.parse(execution.pending_approval.expires_at) <= now.getTime()) throw new Error('APPROVAL_EXPIRED');
      if (input.state_version !== undefined && input.state_version !== execution.cursor.state_version) throw new Error('STALE_APPROVAL_STATE');
      if (!execution.pending_approval.allowed_decisions.includes(input.decision)) throw new Error('APPROVAL_DECISION_NOT_ALLOWED');
      const suppliedAuthorities = new Set(input.authority_ids ?? []);
      if (execution.pending_approval.authority_requirement_ids.some((required) => !suppliedAuthorities.has(required))) throw new Error('APPROVAL_AUTHORITY_REQUIREMENT_NOT_MET');
      const existingApprovers = execution.pending_approval.approvers ?? [];
      const quorum = execution.pending_approval.quorum ?? 1;
      if (existingApprovers.includes(input.principal)) throw new Error('APPROVAL_PRINCIPAL_ALREADY_RECORDED');
      const approvalRef = this.store.approvalRef(input.execution_id, `${input.approval_id}_${encodeURIComponent(input.principal)}`);
      const recorded = await tx.get(approvalRef);
      if (recorded.exists) throw new Error('APPROVAL_ALREADY_RECORDED');
      const nextStatus: RuntimeStatus = input.decision === 'APPROVE' ? 'RUNNING' : 'HALTED';
      const event = appendEvent(execution, { type: input.decision === 'APPROVE' ? 'APPROVAL_ACCEPTED' : 'APPROVAL_REJECTED', node_id: input.node_id, payload: { approval_id: input.approval_id }, actor: { principal: input.principal, authority_ids: input.authority_ids ?? [] } }, now);
      const approvers = input.decision === 'APPROVE' ? [...existingApprovers, input.principal] : existingApprovers;
      const quorumReached = input.decision === 'APPROVE' && approvers.length >= quorum;
      const resumedCursor = quorumReached ? (() => {
        if (!execution.runbook_document) throw new Error('TRUSTED_APPROVAL_DOCUMENT_REQUIRED');
        const document = RBIRDocumentSchema.parse(execution.runbook_document);
        if (document.runbook.id !== execution.runbook.id || document.runbook.version !== execution.runbook.version || document.runbook.tenant_id !== execution.tenant_id || document.capability_manifest.capability_manifest_sha256 !== execution.runbook.manifest_sha256) throw new Error('APPROVAL_DOCUMENT_CONTEXT_MISMATCH');
        const result = advanceDeterministically(document, input.node_id, 'APPROVE');
        return { active_tokens: { main: { node_id: result.nextNodeId, node_attempt: 1 } }, state_version: execution.cursor.state_version + 1 };
      })() : { ...execution.cursor, state_version: execution.cursor.state_version + 1 };
      const updated = { ...execution, status: quorumReached ? nextStatus : input.decision === 'REJECT' ? 'HALTED' as const : 'SUSPENDED_APPROVAL' as const, pending_approval: { ...execution.pending_approval, quorum, approvers, status: quorumReached ? 'APPROVED' as const : input.decision === 'REJECT' ? 'REJECTED' as const : 'PENDING' as const }, cursor: resumedCursor, last_event_sequence: event.sequence, last_event_hash: event.event_hash, updated_at: now.toISOString() };
      tx.create(approvalRef, { ...input, recorded_at: now.toISOString() });
      tx.update(ref, updated);
      tx.create(this.store.eventRef(input.execution_id, event.sequence), event);
      tx.create(this.store.outboxRef(input.execution_id, event.sequence), { execution_id: input.execution_id, sequence: event.sequence, event, status: 'PENDING', created_at: now.toISOString() });
      return updated;
    });
  }
}
