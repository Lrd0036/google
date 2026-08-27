import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const compose = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const project = 'runbook-local-dev';
const documentId = `approval-smoke-${Date.now()}`;
const firestoreBase = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents`;
const { initialEventHash } = await import('../apps/control/dist/runtime.js');
const { issueApprovalAssertion } = await import('../apps/control/dist/authority.js');

function field(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, field(child)])) } };
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(url)).status !== 0) return; } catch { /* startup */ }
    await wait(200);
  }
  throw new Error(`service did not start: ${url}`);
}
async function firestoreCreate(value) {
  const response = await fetch(`${firestoreBase}/executions?documentId=${encodeURIComponent(documentId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, field(child)])) }) });
  if (!response.ok) throw new Error(`Firestore seed failed ${response.status}: ${await response.text()}`);
}
const createdAt = new Date().toISOString();
const runbook = { id: 'approval-smoke', version: 1, ir_sha256: `sha256:${'a'.repeat(64)}`, manifest_sha256: `sha256:${'b'.repeat(64)}` };
const document = { ir_version: 'rbir/v0.1', runbook: { id: 'approval-smoke', version: 1, compiled_at: createdAt, compiler_version: '0.1.0', tenant_id: 'local-tenant' }, source: { uri: 'local://approval-smoke', source_sha256: `sha256:${'c'.repeat(64)}` }, capability_manifest: { id: 'local', version: 1, capability_manifest_sha256: `sha256:${'b'.repeat(64)}` }, entry_node: 'approve', context_schema: { type: 'object' }, authority_model: [], obligations: [], policy_constraints: [], nodes: [{ id: 'approve', kind: 'HUMAN_APPROVAL', description: 'Approve', statement_ids: [], outcomes: ['APPROVE', 'REJECT'], approval: { role: 'local-incident-commander', quorum: 1 } }, { id: 'done', kind: 'TERMINAL', description: 'Done', statement_ids: [], outcomes: ['TERMINATED'], terminal: { status: 'RESOLVED', reason: 'approved' } }], edges: [{ id: 'approve-edge', from: 'approve', on: 'APPROVE', to: 'done' }] };
const execution = { execution_id: documentId, tenant_id: 'local-tenant', status: 'SUSPENDED_APPROVAL', runbook, runbook_document: document, cursor: { active_tokens: { main: { node_id: 'approve', node_attempt: 1 } }, state_version: 1 }, pending_approval: { approval_id: 'apr-smoke', node_id: 'approve', allowed_decisions: ['APPROVE', 'REJECT'], authority_requirement_ids: ['local-incident-commander'], quorum: 1, approvers: [], status: 'PENDING' }, last_event_sequence: 0, last_event_hash: initialEventHash({ execution_id: documentId, tenant_id: 'local-tenant', runbook, created_at: createdAt }), context: {}, created_at: createdAt, updated_at: createdAt };
try {
  execFileSync('docker', [...compose, 'up', '-d', '--build'], { stdio: 'ignore' });
  await waitFor('http://127.0.0.1:8080/health');
  await waitFor('http://127.0.0.1:8085');
  await firestoreCreate(execution);
  const before = await fetch(`http://127.0.0.1:8080/executions/${documentId}/audit`);
  const beforeBody = await before.json();
  const unsignedResume = await fetch('http://127.0.0.1:8080/events/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: 'apr-smoke', execution_id: documentId, node_id: 'approve', decision: 'APPROVE', principal: 'untrusted-client' }) });
  const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const attackerAssertion = issueApprovalAssertion({ issuer: 'rb-authority-local', audience: 'rb-control', tenant_id: 'local-tenant', authority_id: 'local-incident-commander', execution_id: documentId, runbook_ir_sha256: runbook.ir_sha256, node_id: 'approve', trigger_sha256: `sha256:${'0'.repeat(64)}`, target_scope_sha256: `sha256:${'0'.repeat(64)}` }, 'local-operator', 'APPROVE', attackerKeys.privateKey);
  const selfSignedResume = await fetch('http://127.0.0.1:8080/events/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: 'apr-smoke', execution_id: documentId, assertion: attackerAssertion, public_key: attackerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }) });
  const untrustedContext = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, approval_id: 'apr-smoke', principal: 'local-operator', authority_id: 'local-incident-commander', decision: 'APPROVE', document }) });
  const approval = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, approval_id: 'apr-smoke', principal: 'local-operator', decision: 'APPROVE' }) });
  const approvalBody = await approval.json();
  const after = await fetch(`http://127.0.0.1:8080/executions/${documentId}/audit`);
  const afterBody = await after.json();
  if (!before.ok || beforeBody.event_chain_valid !== true || unsignedResume.status !== 400 || selfSignedResume.status !== 400 || untrustedContext.status !== 400 || !approval.ok || approvalBody.ok !== true || !after.ok || afterBody.event_chain_valid !== true || afterBody.execution.status !== 'RUNNING' || afterBody.events.length !== 1) throw new Error(`approval/audit assertion failed: ${JSON.stringify({ before: beforeBody, unsigned_resume: unsignedResume.status, self_signed_resume: selfSignedResume.status, untrusted_context: untrustedContext.status, approval: approvalBody, after: afterBody })}`);
  console.log(JSON.stringify({ ok: true, seeded: true, unsigned_resume_rejected: true, self_signed_resume_rejected: true, caller_authority_context_rejected: true, approval_recorded: true, audit_before_valid: beforeBody.event_chain_valid, audit_after_valid: afterBody.event_chain_valid, emitted_events: afterBody.events.length }));
} finally {
  execFileSync('docker', [...compose, 'down'], { stdio: 'ignore' });
}
