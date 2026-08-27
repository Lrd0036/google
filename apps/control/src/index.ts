import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { RBIRDocumentSchema } from '@runbook/types';
import { FirestoreExecutionStore, ExecutionController, initialEventHash, requireFirestoreDocumentId } from './runtime.js';
import { FirestoreApprovalReplayStore, MemoryApprovalReplayStore, verifyApprovalAssertion } from './authority.js';
import { PubSubResumeEventPublisher } from './resume-events.js';
import { executeOverBroker } from './local-orchestrator.js';
import { buildAuditBundle } from './audit.js';
import { ArtifactAdmissionStore } from './artifact-store.js';
export * from './scheduler.js';
export * from './audit.js';

export * from './local-executor.js';
export * from './authority.js';
export * from './resume-events.js';
export * from './local-orchestrator.js';
export * from './artifact-store.js';

const port = Number(process.env.PORT || 8080);
const localMode = process.env.DEPLOYMENT_MODE === 'local';
const cloudExecutionEnabled = process.env.CLOUD_EXECUTION_ENABLED === 'true';
const localOrchestrationEnabled = localMode && process.env.LOCAL_ORCHESTRATION === 'true';
const localAuthorityEnabled = localMode && process.env.LOCAL_AUTHORITY === 'true';
const firestore = new Firestore({ projectId: process.env.GCP_PROJECT || 'runbook-local-dev' });
const executionCollection = localMode ? 'executions' : 'v1_executions';
const controller = new ExecutionController(new FirestoreExecutionStore(firestore, executionCollection));
const artifactStore = new ArtifactAdmissionStore(firestore, process.env.ARTIFACT_BUCKET);
const approvalReplay = new MemoryApprovalReplayStore();
const cloudApprovalReplay = new FirestoreApprovalReplayStore(firestore);
const approvalKms = !localMode && process.env.APPROVAL_KMS_KEY_VERSION ? new (await import('@google-cloud/kms')).KeyManagementServiceClient() : undefined;
const resumePublisher = process.env.PUBSUB_EMULATOR_HOST ? new PubSubResumeEventPublisher() : undefined;
const localAuthorityKeys = localAuthorityEnabled ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : undefined;
const localAuthorityId = process.env.LOCAL_AUTHORITY_ID ?? '';
const localOperatorPrincipals = new Set((process.env.LOCAL_OPERATOR_PRINCIPALS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
if (localAuthorityEnabled && (!localAuthorityId || localOperatorPrincipals.size === 0)) throw new Error('LOCAL_AUTHORITY requires LOCAL_AUTHORITY_ID and LOCAL_OPERATOR_PRINCIPALS');
const maxJsonBodyBytes = Number(process.env.MAX_JSON_BODY_BYTES || 1_048_576);
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`; }
function sha256(value: unknown): string { return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`; }

async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxJsonBodyBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function routeExecutionId(encoded: string): string {
  return requireFirestoreDocumentId(decodeURIComponent(encoded), 'execution id');
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,authorization' });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    respond(res, 200, { status: 'HEALTHY', service: 'rb-control' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/executions') {
    try {
      const snapshot = await firestore.collection(executionCollection).get();
      respond(res, 200, { executions: snapshot.docs.map((doc) => doc.data()) });
    } catch (error) { respond(res, 503, { error: error instanceof Error ? error.message : 'Execution listing failed' }); }
    return;
  }

  const eventsMatch = /^\/executions\/([^/]+)\/events$/.exec(url.pathname);
  if (req.method === 'GET' && eventsMatch?.[1]) {
    try {
      const executionId = routeExecutionId(eventsMatch[1]);
      const snapshot = await firestore.collection(executionCollection).doc(executionId).collection('events').orderBy('sequence', 'asc').get();
      respond(res, 200, { events: snapshot.docs.map((doc) => doc.data()) });
    } catch (error) { respond(res, 503, { error: error instanceof Error ? error.message : 'Execution event lookup failed' }); }
    return;
  }

  const auditMatch = /^\/executions\/([^/]+)\/audit$/.exec(url.pathname);
  if (req.method === 'GET' && auditMatch?.[1]) {
    try {
      const executionId = routeExecutionId(auditMatch[1]);
      const executionSnapshot = await firestore.collection(executionCollection).doc(executionId).get();
      if (!executionSnapshot.exists) { respond(res, 404, { error: 'EXECUTION_NOT_FOUND' }); return; }
      const execution = executionSnapshot.data() as Parameters<typeof buildAuditBundle>[0];
      const eventSnapshot = await firestore.collection(executionCollection).doc(executionId).collection('events').orderBy('sequence', 'asc').get();
      respond(res, 200, buildAuditBundle(execution, eventSnapshot.docs.map((doc) => doc.data()) as Parameters<typeof buildAuditBundle>[1], { runbook: execution.runbook } , new Date().toISOString(), initialEventHash(execution)));
    } catch (error) { respond(res, 503, { error: error instanceof Error ? error.message : 'Audit export failed' }); }
    return;
  }

  if (localOrchestrationEnabled && req.method === 'POST' && url.pathname === '/local/execute') {
    try {
      const body = await readJson(req);
      const executionId = body.execution_id === undefined ? undefined : requireFirestoreDocumentId(body.execution_id, 'execution id');
      const result = await executeOverBroker(body.document, body.manifest, (body.context ?? {}) as Record<string, unknown>, { brokerUrl: process.env.BROKER_URL || 'http://localhost:8081', executionId, triggerSha256: typeof body.trigger_sha256 === 'string' ? body.trigger_sha256 : undefined, startNodeId: typeof body.start_node === 'string' ? body.start_node : undefined });
      respond(res, 200, result);
    } catch (error) { respond(res, 400, { error: error instanceof Error ? error.message : 'Local orchestration failed' }); }
    return;
  }

  const executionMatch = /^\/executions\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && executionMatch?.[1]) {
    try {
      const snapshot = await firestore.collection(executionCollection).doc(routeExecutionId(executionMatch[1])).get();
      if (!snapshot.exists) { respond(res, 404, { error: 'EXECUTION_NOT_FOUND' }); return; }
      respond(res, 200, snapshot.data());
    } catch (error) { respond(res, 503, { error: error instanceof Error ? error.message : 'Execution lookup failed' }); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/executions') {
    try {
      if (!localMode && !cloudExecutionEnabled) { respond(res, 503, { error: 'RELEASE_GATE_CLOSED' }); return; }
      const body = await readJson(req);
      const now = new Date().toISOString();
      const executionId = body.execution_id === undefined ? `exec_${Date.now()}` : requireFirestoreDocumentId(body.execution_id, 'execution id');
      if (!localMode && ('document' in body || 'runbook' in body || 'entry_node' in body)) throw new Error('CALLER_SUPPLIED_RBIR_REJECTED');
      const artifact = !localMode && typeof body.artifact_id === 'string' ? await artifactStore.load(body.artifact_id) : undefined;
      if (!localMode && !artifact) throw new Error('ADMITTED_ARTIFACT_REQUIRED');
      const runbook = (artifact ? { id: artifact.document.runbook.id, version: artifact.document.runbook.version, ir_sha256: artifact.admission.rbir_sha256, manifest_sha256: artifact.admission.manifest_sha256 } : body.runbook ?? {}) as Record<string, unknown>;
      const entryNode = artifact?.document.entry_node ?? body.entry_node;
      if (typeof body.tenant_id !== 'string' || !body.tenant_id || typeof runbook.id !== 'string' || typeof runbook.version !== 'number' || typeof runbook.ir_sha256 !== 'string' || typeof runbook.manifest_sha256 !== 'string' || typeof entryNode !== 'string') throw new Error('INVALID_EXECUTION_REQUEST');
      const document = artifact?.document ?? (body.document === undefined ? undefined : RBIRDocumentSchema.parse(body.document));
      if (document && (document.runbook.id !== runbook.id || document.runbook.version !== runbook.version || document.runbook.tenant_id !== body.tenant_id || document.capability_manifest.capability_manifest_sha256 !== runbook.manifest_sha256 || document.entry_node !== entryNode)) throw new Error('EXECUTION_DOCUMENT_CONTEXT_MISMATCH');
      const ref = firestore.collection(executionCollection).doc(executionId);
      const triggerPayload = body.trigger ?? {};
      const execution = { execution_id: executionId, tenant_id: String(body.tenant_id ?? 'unknown'), status: 'PENDING', runbook: { id: String(runbook.id ?? 'unknown'), version: Number(runbook.version ?? 1), ir_sha256: String(runbook.ir_sha256 ?? `sha256:${'0'.repeat(64)}`), manifest_sha256: String(runbook.manifest_sha256 ?? `sha256:${'0'.repeat(64)}`), ...(artifact ? { gcs_generation: artifact.admission.generation, compiler_identity: artifact.admission.compiler_identity, artifact_object: artifact.admission.object } : {}) }, ...(document ? { runbook_document: document } : {}), cursor: { active_tokens: { main: { node_id: artifact?.document.entry_node ?? String(body.entry_node ?? 'unknown'), node_attempt: 1 } }, state_version: 1 }, control_epoch: 1, pending_approval: null, last_event_sequence: 0, last_event_hash: initialEventHash({ execution_id: executionId, tenant_id: String(body.tenant_id ?? 'unknown'), runbook: { id: String(runbook.id ?? 'unknown'), version: Number(runbook.version ?? 1), ir_sha256: String(runbook.ir_sha256 ?? `sha256:${'0'.repeat(64)}`), manifest_sha256: String(runbook.manifest_sha256 ?? `sha256:${'0'.repeat(64)}`) }, created_at: now }), context: body.context ?? {}, trigger: { payload: triggerPayload, sha256: sha256(triggerPayload) }, created_at: now, updated_at: now };
      await firestore.runTransaction(async (tx) => { const existing = await tx.get(ref); if (existing.exists) throw new Error('EXECUTION_ALREADY_EXISTS'); tx.create(ref, execution); });
      respond(res, 201, execution);
    } catch (error) { respond(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
    return;
  }

  if ((localAuthorityEnabled || (!localMode && cloudExecutionEnabled)) && req.method === 'POST' && url.pathname === '/events/resume') {
    try {
      const envelope = await readJson(req);
      const message = envelope.message as Record<string, unknown> | undefined;
      const encoded = typeof message?.data === 'string' ? message.data : undefined;
      const input = (encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : envelope) as Record<string, unknown>;
      if (!input.assertion) throw new Error('SIGNED_APPROVAL_REQUIRED');
      {
        const executionId = requireFirestoreDocumentId(input.execution_id, 'execution id');
        if (typeof input.approval_id !== 'string') throw new Error('INVALID_RESUME_REQUEST');
        input.execution_id = executionId;
        const snapshot = await firestore.collection(executionCollection).doc(executionId).get();
        const execution = snapshot.data() as { tenant_id: string; runbook: { ir_sha256: string }; trigger?: { sha256: string }; target_scope_sha256?: string; pending_approval?: { node_id: string; authority_requirement_ids: string[] } } | undefined;
        if (!execution?.pending_approval) throw new Error('APPROVAL_NOT_PENDING');
        const asserted = input.assertion as Record<string, unknown>;
        if (typeof asserted.authority_id !== 'string' || !execution.pending_approval.authority_requirement_ids.includes(asserted.authority_id)) throw new Error('APPROVAL_AUTHORITY_REQUIREMENT_NOT_MET');
        if (typeof asserted.sub !== 'string') throw new Error('APPROVAL_PRINCIPAL_MISSING');
        if (localMode && !localOperatorPrincipals.has(asserted.sub)) throw new Error('UNTRUSTED_LOCAL_OPERATOR');
        const cloudPublicKey = approvalKms && process.env.APPROVAL_KMS_KEY_VERSION ? (await approvalKms.getPublicKey({ name: process.env.APPROVAL_KMS_KEY_VERSION }))[0].pem : undefined;
        const assertion = verifyApprovalAssertion(input.assertion, localMode ? localAuthorityKeys!.publicKey : String(cloudPublicKey ?? ''), {
          issuer: localMode ? process.env.AUTHORITY_ISSUER || 'rb-authority-local' : 'rb-authority',
          audience: process.env.AUTHORITY_AUDIENCE || 'rb-control',
          tenant_id: execution.tenant_id,
          authority_id: asserted.authority_id,
          principal: asserted.sub,
          execution_id: executionId,
          runbook_ir_sha256: execution.runbook.ir_sha256,
          node_id: execution.pending_approval.node_id,
          trigger_sha256: execution.trigger?.sha256 || 'sha256:' + '0'.repeat(64),
          target_scope_sha256: execution.target_scope_sha256 || 'sha256:' + '0'.repeat(64),
        });
        const consumed = localMode ? approvalReplay.consume(assertion) : await cloudApprovalReplay.consume(assertion);
        if (!consumed) throw new Error('APPROVAL_ASSERTION_REPLAY');
        input.decision = assertion.decision;
        input.principal = assertion.sub;
        input.node_id = assertion.node_id;
        input.authority_ids = [assertion.authority_id];
        delete input.assertion;
      }
      const approvalInput = input as unknown as Parameters<ExecutionController['ingestApproval']>[0];
      const result = await controller.ingestApproval(approvalInput);
      if (resumePublisher) await resumePublisher.publish({ schema: 'runbook-resume/v0.1', event_id: `resume-${approvalInput.approval_id}-${result.cursor.state_version}`, execution_id: result.execution_id, cause: 'HUMAN_APPROVAL', approval_id: approvalInput.approval_id, state_version: result.cursor.state_version });
      respond(res, 200, { ok: true, execution_id: result.execution_id, state_version: result.cursor.state_version });
    } catch (error) { respond(res, 400, { error: error instanceof Error ? error.message : 'Invalid resume event' }); }
    return;
  }

  if (localAuthorityEnabled && req.method === 'POST' && url.pathname === '/local/approve') {
    try {
      const body = await readJson(req);
      if (typeof body.execution_id !== 'string' || typeof body.approval_id !== 'string' || typeof body.principal !== 'string' || (body.decision !== 'APPROVE' && body.decision !== 'REJECT')) throw new Error('INVALID_LOCAL_APPROVAL');
      if ('document' in body || 'authority_id' in body) throw new Error('CALLER_PROVIDED_AUTHORITY_CONTEXT_NOT_ALLOWED');
      if (!localOperatorPrincipals.has(body.principal)) throw new Error('UNTRUSTED_LOCAL_OPERATOR');
      const executionId = requireFirestoreDocumentId(body.execution_id, 'execution id');
      const snapshot = await firestore.collection('executions').doc(executionId).get();
      const execution = snapshot.data() as { tenant_id: string; runbook: { ir_sha256: string }; created_at: string; trigger?: { sha256: string }; target_scope_sha256?: string; pending_approval?: { node_id: string; authority_requirement_ids: string[] } } | undefined;
      if (!execution?.pending_approval) throw new Error('APPROVAL_NOT_PENDING');
      if (!execution.pending_approval.authority_requirement_ids.includes(localAuthorityId)) throw new Error('APPROVAL_AUTHORITY_REQUIREMENT_NOT_MET');
      const context = { issuer: process.env.AUTHORITY_ISSUER || 'rb-authority-local', audience: process.env.AUTHORITY_AUDIENCE || 'rb-control', tenant_id: execution.tenant_id, authority_id: localAuthorityId, execution_id: body.execution_id, runbook_ir_sha256: execution.runbook.ir_sha256, node_id: execution.pending_approval.node_id, trigger_sha256: execution.trigger?.sha256 || 'sha256:' + '0'.repeat(64), target_scope_sha256: execution.target_scope_sha256 || 'sha256:' + '0'.repeat(64) };
      const { issueApprovalAssertion } = await import('./authority.js');
      const assertion = issueApprovalAssertion(context, body.principal, body.decision, localAuthorityKeys!.privateKey);
      if (!approvalReplay.consume(assertion)) throw new Error('APPROVAL_ASSERTION_REPLAY');
      const result = await controller.ingestApproval({ approval_id: body.approval_id, execution_id: body.execution_id, node_id: assertion.node_id, decision: assertion.decision, principal: assertion.sub, authority_ids: [assertion.authority_id] });
      if (resumePublisher) await resumePublisher.publish({ schema: 'runbook-resume/v0.1', event_id: `resume-${body.approval_id}-${result.cursor.state_version}`, execution_id: result.execution_id, cause: 'HUMAN_APPROVAL', approval_id: body.approval_id, state_version: result.cursor.state_version });
      respond(res, 200, { ok: true, execution_id: result.execution_id, state_version: result.cursor.state_version, assertion_jti: assertion.jti });
    } catch (error) { respond(res, 400, { error: error instanceof Error ? error.message : 'Local approval failed' }); }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, () => {
  console.log(`[rb-control] Control plane service running on port ${port}`);
});
