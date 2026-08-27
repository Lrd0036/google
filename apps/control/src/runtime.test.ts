import assert from 'node:assert/strict';
import test from 'node:test';
import { appendEvent, ExecutionController, initialEventHash, requireFirestoreDocumentId, verifyEventChain, type ExecutionDocument } from './runtime.js';
import { executeLocally } from './local-executor.js';
import { buildAuditBundle } from './audit.js';

function execution(): ExecutionDocument {
  const created = new Date().toISOString();
  const base = { execution_id: 'e', tenant_id: 't', runbook: { id: 'r', version: 1, ir_sha256: 'sha256:' + 'a'.repeat(64), manifest_sha256: 'sha256:' + 'b'.repeat(64) }, created_at: created };
  return { ...base, status: 'RUNNING', cursor: { active_tokens: { main: { node_id: 'n', node_attempt: 1 } }, state_version: 1 }, last_event_sequence: 0, last_event_hash: initialEventHash(base), context: {}, updated_at: created };
}

test('runtime event chain detects tampering', () => {
  const state = execution();
  const first = appendEvent(state, { type: 'TEST', actor: { principal: 'test', authority_ids: [] } });
  const next = { ...state, last_event_sequence: first.sequence, last_event_hash: first.event_hash };
  const second = appendEvent(next, { type: 'TEST_2', actor: { principal: 'test', authority_ids: [] } });
  assert.equal(verifyEventChain(state.last_event_hash, [first, second]), true);
  assert.equal(verifyEventChain(state.last_event_hash, [{ ...first, type: 'TAMPERED' }, second]), false);
});

test('audit bundle records chain validity and preserves ordered events', () => {
  const state = execution();
  const first = appendEvent(state, { type: 'ONE', actor: { principal: 'test', authority_ids: [] } });
  const next = { ...state, last_event_sequence: first.sequence, last_event_hash: first.event_hash };
  const second = appendEvent(next, { type: 'TWO', actor: { principal: 'test', authority_ids: [] } });
  const bundle = buildAuditBundle({ ...next, last_event_sequence: second.sequence, last_event_hash: second.event_hash }, [second, first], { ir: 'local' }, '2026-01-01T00:00:00.000Z', state.last_event_hash);
  assert.equal(bundle.event_chain_valid, true);
  assert.deepEqual(bundle.events.map((event) => event.type), ['ONE', 'TWO']);
  assert.deepEqual(bundle.artifacts, { ir: 'local' });
});

test('local executor resolves bindings and verifies a completed action', async () => {
  const document = { entry_node: 'a', nodes: [
    { id: 'a', kind: 'ACTION' as const, statement_ids: [], description: 'a', outcomes: ['ACTION_SUCCEEDED'], action: { capability: 'x@1', parameters: { job_id: { ref: '/context/job_id' } } } },
    { id: 'v', kind: 'VERIFY' as const, statement_ids: [], description: 'v', outcomes: ['VERIFIED', 'FAILED'], verify: { target_action_node: 'a', capability: 'y@1', expected_state: { status: 'COMPLETED' } } },
    { id: 'done', kind: 'TERMINAL' as const, statement_ids: [], description: 'done', outcomes: ['TERMINATED'], terminal: { status: 'RESOLVED' as const, reason: 'ok' } },
  ], edges: [{ id: '1', from: 'a', on: 'ACTION_SUCCEEDED', to: 'v' }, { id: '2', from: 'v', on: 'VERIFIED', to: 'done' }] } as never;
  const result = await executeLocally(document, { job_id: 'job-1' }, async (_node, params) => ({ status: 'COMPLETED', response: { status: 'COMPLETED', ...params } }));
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.trace, ['a', 'v', 'done']);
});

test('local executor fails closed for missing deterministic context', async () => {
  const document = { entry_node: 'classify', nodes: [
    { id: 'classify', kind: 'DETERMINISTIC' as const, statement_ids: [], description: 'classify', outcomes: ['TRANSIENT', 'UNKNOWN'] },
    { id: 'mutate', kind: 'ACTION' as const, statement_ids: [], description: 'mutate', outcomes: ['ACTION_SUCCEEDED'], action: { capability: 'x@1', parameters: {} } },
  ], edges: [{ id: '1', from: 'classify', on: 'TRANSIENT', to: 'mutate' }] } as never;
  let dispatched = false;
  const result = await executeLocally(document, {}, async () => { dispatched = true; return { status: 'COMPLETED' }; });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error, 'UNMAPPED_DETERMINISTIC_CONTEXT:classify');
  assert.equal(dispatched, false);
});

test('Firestore document identifiers reject path separators and decoded path injection', () => {
  assert.equal(requireFirestoreDocumentId('exec_01-test', 'execution id'), 'exec_01-test');
  assert.throws(() => requireFirestoreDocumentId('victim/events/1', 'execution id'), /INVALID_EXECUTION_ID/);
  assert.throws(() => requireFirestoreDocumentId(decodeURIComponent('victim%2Fevents%2F1'), 'execution id'), /INVALID_EXECUTION_ID/);
});

test('approval quorum requires distinct principals before resuming', async () => {
  const state = execution();
  state.status = 'SUSPENDED_APPROVAL';
  state.cursor = { active_tokens: { main: { node_id: 'approve', node_attempt: 1 } }, state_version: 4 };
  state.pending_approval = { approval_id: 'apr-1', node_id: 'approve', allowed_decisions: ['APPROVE', 'REJECT'], authority_requirement_ids: ['ops'], quorum: 2, approvers: [], status: 'PENDING' };
  const records = new Map<string, unknown>([['executions/e', state]]);
  const ref = (path: string) => ({ path });
  const store = {
    executionRef: (id: string) => ref(`executions/${id}`),
    eventRef: (id: string, sequence: number) => ref(`executions/${id}/events/${sequence}`),
    approvalRef: (id: string, approvalId: string) => ref(`executions/${id}/approvals/${approvalId}`),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => callback({
      get: async (reference: { path: string }) => ({ exists: records.has(reference.path), data: () => records.get(reference.path) }),
      create: (reference: { path: string }, value: unknown) => records.set(reference.path, value),
      update: (reference: { path: string }, value: unknown) => records.set(reference.path, value),
    }),
  } as never;
  const controller = new ExecutionController(store);
  const document = { ir_version: 'rbir/v0.1', runbook: { id: 'r', version: 1, compiled_at: new Date().toISOString(), compiler_version: '0.1.0', tenant_id: 't' }, source: { uri: 'local://test', source_sha256: `sha256:${'a'.repeat(64)}` }, capability_manifest: { id: 'local', version: 1, capability_manifest_sha256: `sha256:${'b'.repeat(64)}` }, entry_node: 'approve', context_schema: { type: 'object' }, authority_model: [], obligations: [], policy_constraints: [], nodes: [{ id: 'approve', kind: 'HUMAN_APPROVAL', description: 'approve', statement_ids: [], outcomes: ['APPROVE', 'REJECT'], approval: { role: 'ops', quorum: 2 } }, { id: 'done', kind: 'TERMINAL', description: 'done', statement_ids: [], outcomes: ['TERMINATED'], terminal: { status: 'RESOLVED', reason: 'ok' } }], edges: [{ id: 'approve-edge', from: 'approve', on: 'APPROVE', to: 'done' }] } as never;
  state.runbook_document = document;
  await assert.rejects(() => controller.ingestApproval({ approval_id: 'apr-1', execution_id: 'e', node_id: 'approve', decision: 'APPROVE', principal: 'untrusted', authority_ids: [] }), /APPROVAL_AUTHORITY_REQUIREMENT_NOT_MET/);
  const first = await controller.ingestApproval({ approval_id: 'apr-1', execution_id: 'e', node_id: 'approve', decision: 'APPROVE', principal: 'user-1', authority_ids: ['ops'] });
  assert.equal(first.status, 'SUSPENDED_APPROVAL');
  await assert.rejects(() => controller.ingestApproval({ approval_id: 'apr-1', execution_id: 'e', node_id: 'approve', decision: 'APPROVE', principal: 'user-1', authority_ids: ['ops'] }), /PRINCIPAL_ALREADY_RECORDED/);
  const second = await controller.ingestApproval({ approval_id: 'apr-1', execution_id: 'e', node_id: 'approve', decision: 'APPROVE', principal: 'user-2', authority_ids: ['ops'] });
  assert.equal(second.status, 'RUNNING');
  assert.deepEqual(second.pending_approval?.approvers, ['user-1', 'user-2']);
});

test('approval transitions fail closed without a stored trusted graph', async () => {
  const state = execution();
  state.status = 'SUSPENDED_APPROVAL';
  state.pending_approval = { approval_id: 'apr-1', node_id: 'approve', allowed_decisions: ['APPROVE'], authority_requirement_ids: ['ops'], quorum: 1, approvers: [], status: 'PENDING' };
  const records = new Map<string, unknown>([['executions/e', state]]);
  const store = {
    executionRef: (id: string) => ({ path: `executions/${id}` }),
    eventRef: (id: string, sequence: number) => ({ path: `executions/${id}/events/${sequence}` }),
    approvalRef: (id: string, approvalId: string) => ({ path: `executions/${id}/approvals/${approvalId}` }),
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => callback({
      get: async (reference: { path: string }) => ({ exists: records.has(reference.path), data: () => records.get(reference.path) }),
      create: (reference: { path: string }, value: unknown) => records.set(reference.path, value),
      update: (reference: { path: string }, value: unknown) => records.set(reference.path, value),
    }),
  } as never;
  await assert.rejects(() => new ExecutionController(store).ingestApproval({ approval_id: 'apr-1', execution_id: 'e', node_id: 'approve', decision: 'APPROVE', principal: 'user-1', authority_ids: ['ops'] }), /TRUSTED_APPROVAL_DOCUMENT_REQUIRED/);
});
