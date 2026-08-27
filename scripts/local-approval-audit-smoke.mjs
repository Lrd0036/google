import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

const compose = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const project = 'runbook-local-dev';
const documentId = `approval-smoke-${Date.now()}`;
const wrongExecutionId = `approval-smoke-wrong-${Date.now()}`;
const firestoreBase = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents`;
const { initialEventHash } = await import('../apps/control/dist/runtime.js');
const { issueApprovalAssertion, verifyApprovalAssertion } = await import('../apps/control/dist/authority.js');
const { compilePlan } = await import('../packages/compiler/dist/compile.js');

function field(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (typeof value === 'boolean') return { booleanValue: value };
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
async function firestoreCreate(id, value) {
  const response = await fetch(`${firestoreBase}/executions?documentId=${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, field(child)])) }) });
  if (!response.ok) throw new Error(`Firestore seed failed ${response.status}: ${await response.text()}`);
}
const createdAt = new Date().toISOString();
const source = readFileSync(new URL('../fixtures/runbooks/acme-ingestion-recovery.md', import.meta.url), 'utf8');
const plan = JSON.parse(readFileSync(new URL('../fixtures/compile-plans/acme-ingestion-recovery.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifests/acme-operations.json', import.meta.url), 'utf8'));
const compiled = compilePlan(source, 'fixtures/runbooks/acme-ingestion-recovery.md', plan, manifest);
if (compiled.lint.hasErrors) throw new Error(JSON.stringify(compiled.lint.artifact));
const document = compiled.document;
const runbook = { id: document.runbook.id, version: document.runbook.version, ir_sha256: document.source.source_sha256, manifest_sha256: document.capability_manifest.capability_manifest_sha256 };
const jobId = 'job-local-approval';
const execution = {
  execution_id: documentId,
  tenant_id: 'acme-demo',
  status: 'SUSPENDED_APPROVAL',
  runbook,
  runbook_document: document,
  cursor: { active_tokens: { main: { node_id: 'approve_auth', node_attempt: 1 } }, state_version: 1 },
  pending_approval: { approval_id: 'apr-smoke', node_id: 'approve_auth', allowed_decisions: ['APPROVE', 'REJECT'], authority_requirement_ids: ['local-incident-commander'], quorum: 1, approvers: [], status: 'PENDING' },
  last_event_sequence: 0,
  last_event_hash: initialEventHash({ execution_id: documentId, tenant_id: 'acme-demo', runbook, created_at: createdAt }),
  context: { job_id: jobId },
  created_at: createdAt,
  updated_at: createdAt,
};
try {
  execFileSync('docker', [...compose, 'up', '-d', '--build'], { stdio: 'ignore' });
  await waitFor('http://127.0.0.1:8080/health');
  await waitFor('http://127.0.0.1:8082/health');
  await waitFor('http://127.0.0.1:8085');

  const suspended = await fetch('http://127.0.0.1:8080/local/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      execution_id: `${documentId}-live`,
      document,
      manifest,
      context: {
        job_id: jobId,
        trusted_evidence: { http_status: 401, error_code: 'PARTNER_TOKEN_EXPIRED' },
        model_judgment: { decision: 'AUTHENTICATION_FAILURE', confidence: 1, evidence_ids: ['trusted:http_status'], schema_valid: true },
      },
    }),
  });
  const suspendedBody = await suspended.json();
  if (!suspended.ok || suspendedBody.status !== 'SUSPENDED_APPROVAL' || suspendedBody.current_node !== 'approve_auth' || (suspendedBody.context?.executed_capabilities ?? []).length !== 0) {
    throw new Error(`auth expiry did not suspend for human approval: ${JSON.stringify(suspendedBody)}`);
  }

  const seededFault = await fetch('http://127.0.0.1:8082/capabilities/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_id: jobId, fault_mode: 'AUTH_EXPIRED' }) });
  if (seededFault.status !== 401) throw new Error(`expected AUTH_EXPIRED seed, got ${seededFault.status}: ${await seededFault.text()}`);

  await firestoreCreate(documentId, execution);
  const before = await fetch(`http://127.0.0.1:8080/executions/${documentId}/audit`);
  const beforeBody = await before.json();
  const unsignedResume = await fetch('http://127.0.0.1:8080/events/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: 'apr-smoke', execution_id: documentId, node_id: 'approve_auth', decision: 'APPROVE', principal: 'untrusted-client' }) });
  const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const assertionContext = { issuer: 'rb-authority-local', audience: 'rb-control', tenant_id: 'acme-demo', authority_id: 'local-incident-commander', execution_id: documentId, runbook_ir_sha256: runbook.ir_sha256, node_id: 'approve_auth', trigger_sha256: `sha256:${'0'.repeat(64)}`, target_scope_sha256: `sha256:${'0'.repeat(64)}` };
  const attackerAssertion = issueApprovalAssertion({ ...assertionContext, tenant_id: 'local-tenant' }, 'local-operator', 'APPROVE', attackerKeys.privateKey);
  const expiredAssertion = issueApprovalAssertion(assertionContext, 'local-operator', 'APPROVE', attackerKeys.privateKey, -1);
  let expiredApprovalRejected = false;
  try { verifyApprovalAssertion(expiredAssertion, attackerKeys.publicKey, assertionContext); } catch { expiredApprovalRejected = true; }
  const selfSignedResume = await fetch('http://127.0.0.1:8080/events/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: 'apr-smoke', execution_id: documentId, assertion: attackerAssertion, public_key: attackerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }) });
  const untrustedContext = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, approval_id: 'apr-smoke', principal: 'local-operator', authority_id: 'local-incident-commander', decision: 'APPROVE', document }) });
  const wrongExecution = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: wrongExecutionId, approval_id: 'apr-smoke', principal: 'local-operator', decision: 'APPROVE' }) });
  const approval = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, approval_id: 'apr-smoke', principal: 'local-operator', decision: 'APPROVE' }) });
  const approvalBody = await approval.json();
  const approved = await fetch(`http://127.0.0.1:8080/executions/${documentId}`);
  const approvedBody = await approved.json();
  const startNode = approvedBody.cursor?.active_tokens?.main?.node_id;
  const resumed = await fetch('http://127.0.0.1:8080/local/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, document, manifest, start_node: startNode, context: { job_id: jobId } }) });
  const resumedBody = await resumed.json();
  const replay = await fetch('http://127.0.0.1:8080/local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: documentId, approval_id: 'apr-smoke', principal: 'local-operator', decision: 'APPROVE' }) });
  const after = await fetch(`http://127.0.0.1:8080/executions/${documentId}/audit`);
  const afterBody = await after.json();
  const expectedResume = ['rotate_auth', 'verify_auth', 'retry_job', 'verify_job_completion', 'resolved'];
  if (!before.ok || beforeBody.event_chain_valid !== true || unsignedResume.status !== 400 || selfSignedResume.status !== 400 || !expiredApprovalRejected || untrustedContext.status !== 400 || wrongExecution.status !== 400 || !approval.ok || approvalBody.ok !== true || startNode !== 'rotate_auth' || !resumed.ok || resumedBody.status !== 'COMPLETED' || JSON.stringify(resumedBody.trace) !== JSON.stringify(expectedResume) || replay.status !== 400 || !after.ok || afterBody.event_chain_valid !== true || afterBody.execution.status !== 'RUNNING' || afterBody.events.length !== 1) {
    throw new Error(`approval/audit assertion failed: ${JSON.stringify({ before: beforeBody, unsigned_resume: unsignedResume.status, self_signed_resume: selfSignedResume.status, expired_approval_rejected: expiredApprovalRejected, untrusted_context: untrustedContext.status, wrong_execution: wrongExecution.status, approval: approvalBody, start_node: startNode, resumed: resumedBody, replay: replay.status, after: afterBody })}`);
  }
  mkdirSync('.local/proof', { recursive: true });
  writeFileSync('.local/proof/acme-human-approval.json', `${JSON.stringify({
    schema: 'runbook-compiler-proof/v0.1',
    generated_at: new Date().toISOString(),
    evidence_mode: 'LOCAL_EMULATOR_HTTP',
    mutation_authority: 'LOCAL_MOCK_MUTATION_GATE',
    execution_id: documentId,
    runbook_ir_sha256: runbook.ir_sha256,
    input: { trusted_evidence: { http_status: 401, error_code: 'PARTNER_TOKEN_EXPIRED' } },
    judgment: { decision: 'AUTHENTICATION_FAILURE', schema_valid: true },
    suspension: { status: suspendedBody.status, current_node: suspendedBody.current_node, trace: suspendedBody.trace, executed_capabilities: suspendedBody.context?.executed_capabilities ?? [] },
    transitions: { initial: 'SUSPENDED_APPROVAL', authorized_approval: 'RUNNING', resumed_execution: resumedBody.status, replay_attempt: replay.status },
    rejected_attempts: { unsigned_resume: unsignedResume.status, self_signed_resume: selfSignedResume.status, expired_approval: expiredApprovalRejected, caller_authority_context: untrustedContext.status, wrong_execution: wrongExecution.status },
    resume: { start_node: startNode, trace: resumedBody.trace, executed_capabilities: resumedBody.context?.executed_capabilities ?? [] },
    audit: { before_valid: beforeBody.event_chain_valid, after_valid: afterBody.event_chain_valid, emitted_events: afterBody.events.length },
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    suspended: suspendedBody.status,
    suspend_trace: suspendedBody.trace,
    unsigned_resume_rejected: true,
    self_signed_resume_rejected: true,
    expired_approval_rejected: expiredApprovalRejected,
    caller_authority_context_rejected: true,
    wrong_execution_rejected: true,
    approval_recorded: true,
    resumed_execution: resumedBody.status,
    resume_trace: resumedBody.trace,
    replay_rejected: replay.status === 400,
  }));
} finally {
  execFileSync('docker', [...compose, 'down'], { stdio: 'ignore' });
}
