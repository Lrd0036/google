import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlan } from './compile.js';
import type { CapabilityManifest } from '@runbook/types';

const manifest: CapabilityManifest = {
  manifest_version: 'rb-capabilities/v0.1', id: 'test', version: 1,
  capabilities: [
    { id: 'write', version: 1, description: 'write', semantic_actions: ['write'], mode: 'WRITE', risk: 'R1_REVERSIBLE_LOW', transport: { type: 'HTTP', allowed_host: 'localhost:1', path: '/', method: 'POST' }, input_schema: { type: 'object', properties: { value: { type: 'string' } } }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' },
    { id: 'read', version: 1, description: 'read', semantic_actions: ['read'], mode: 'READ', risk: 'R0_OBSERVE', transport: { type: 'HTTP', allowed_host: 'localhost:1', path: '/', method: 'GET' }, input_schema: { type: 'object' }, output_schema: { type: 'object' }, timeout_ms: 1000, idempotency: { strategy: 'NATIVE_KEY' }, approval_floor: 'PREAPPROVED_RUNBOOK', credential_profile: 'none' },
  ],
};

test('compilePlan emits a validated RBIR document and lint result', () => {
  const result = compilePlan('runbook', 'fixture.md', {
    runbook_id: 'test', version: 1, tenant_id: 'tenant', entry_node: 'start',
    nodes: [
      { id: 'start', kind: 'ACTION', statement_ids: [], description: 'write', outcomes: ['OK'], action: { capability: 'write@1', parameters: {} } },
      { id: 'verify', kind: 'VERIFY', statement_ids: [], description: 'verify', outcomes: ['OK'], verify: { target_action_node: 'start', capability: 'read@1', expected_state: {} } },
      { id: 'done', kind: 'TERMINAL', statement_ids: [], description: 'done', outcomes: ['TERMINATED'], terminal: { status: 'RESOLVED', reason: 'done' } },
    ],
    edges: [{ id: 'a', from: 'start', on: 'OK', to: 'verify' }, { id: 'b', from: 'verify', on: 'OK', to: 'done' }],
  }, manifest);
  assert.equal(result.document.ir_version, 'rbir/v0.1');
  assert.equal(result.document.nodes.length, 3);
  assert.equal(result.lint.hasErrors, false);
});

test('linter rejects unreachable nodes, unsafe verification, and bad pointer types', () => {
  const result = compilePlan('runbook', 'fixture.md', {
    runbook_id: 'test', version: 1, tenant_id: 'tenant', entry_node: 'start',
    context_schema: { type: 'object', properties: { count: { type: 'integer' } }, additionalProperties: false },
    nodes: [
      { id: 'start', kind: 'ACTION', statement_ids: [], description: 'write', outcomes: ['OK'], action: { capability: 'write@1', parameters: { value: { ref: '/context/count' } } } },
      { id: 'done', kind: 'TERMINAL', statement_ids: [], description: 'done', outcomes: ['TERMINATED'], terminal: { status: 'RESOLVED', reason: 'done' } },
      { id: 'orphan', kind: 'TERMINAL', statement_ids: [], description: 'orphan', outcomes: ['TERMINATED'], terminal: { status: 'HALTED', reason: 'orphan' } },
    ],
    edges: [{ id: 'a', from: 'start', on: 'OK', to: 'done' }],
  }, manifest);
  const codes = result.lint.artifact.diagnostics.map((diagnostic) => diagnostic.code);
  assert.equal(codes.includes('RBK-302'), true);
  assert.equal(codes.includes('RBK-601'), true);
});
