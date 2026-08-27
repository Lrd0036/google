import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { GoogleAuth } from 'google-auth-library';
import { ApprovalAssertionSchema } from '@runbook/types';
import { verifyConsoleWorkload, verifyIapIdentity } from './identity.js';

export * from './identity.js';
const port = Number(process.env.PORT ?? 8080);
const project = process.env.GCP_PROJECT ?? '';
const firestore = new Firestore({ projectId: project });
const kms = new KeyManagementServiceClient();
const keyVersion = process.env.APPROVAL_KMS_KEY_VERSION ?? '';
const iapAudience = process.env.IAP_AUDIENCE ?? '';
const consoleIdentity = process.env.CONSOLE_SERVICE_ACCOUNT ?? '';
const controlUrl = process.env.CONTROL_URL ?? '';

function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`; }
async function json(req: import('node:http').IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>; }
function send(res: import('node:http').ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'HEALTHY', service: 'rb-authority' });
  const match = /^\/approvals\/([^/]+)\/decisions$/.exec(url.pathname);
  if (req.method !== 'POST' || !match?.[1]) return send(res, 404, { error: 'Not Found' });
  try {
    await verifyConsoleWorkload(String(req.headers.authorization ?? ''), `https://${req.headers.host ?? ''}`, consoleIdentity);
    const human = await verifyIapIdentity(String(req.headers['x-runbook-iap-jwt'] ?? ''), iapAudience);
    const body = await json(req);
    if (body.decision !== 'APPROVE' && body.decision !== 'REJECT' || typeof body.execution_id !== 'string') throw new Error('INVALID_DECISION');
    const execution = (await firestore.doc(`v1_executions/${body.execution_id}`).get()).data() as { tenant_id?: string; runbook?: { ir_sha256?: string }; trigger?: { sha256?: string }; target_scope_sha256?: string; pending_approval?: { approval_id?: string; node_id?: string; authority_requirement_ids?: string[] } } | undefined;
    if (!execution?.pending_approval || execution.pending_approval.approval_id !== decodeURIComponent(match[1])) throw new Error('APPROVAL_NOT_PENDING');
    const authorityId = execution.pending_approval.authority_requirement_ids?.[0];
    if (!authorityId) throw new Error('AUTHORITY_REQUIREMENT_MISSING');
    const grant = (await firestore.doc(`v1_authority_grants/${authorityId}`).get()).data() as { status?: string; principals?: string[]; quorum?: number } | undefined;
    if (grant?.status !== 'ACTIVE' || !grant.principals?.map((value) => value.toLowerCase()).includes(human.email)) throw new Error('HUMAN_NOT_AUTHORIZED');
    if ((grant.quorum ?? 1) !== 1) throw new Error('QUORUM_NOT_YET_SUPPORTED');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = { typ: 'RB-APPROVAL-ASSERTION', version: '0.1', iss: 'rb-authority', sub: human.email, aud: 'rb-control', iat: now, exp: now + 300, jti: randomUUID(), tenant_id: execution.tenant_id, authority_id: authorityId, execution_id: body.execution_id, runbook_ir_sha256: execution.runbook?.ir_sha256, node_id: execution.pending_approval.node_id, trigger_sha256: execution.trigger?.sha256, target_scope_sha256: execution.target_scope_sha256, decision: body.decision };
    const validated = ApprovalAssertionSchema.omit({ signature: true }).parse(unsigned);
    const digest = createHash('sha256').update(canonical(validated)).digest();
    const [signed] = await kms.asymmetricSign({ name: keyVersion, digest: { sha256: digest } });
    const assertion = ApprovalAssertionSchema.parse({ ...validated, signature: { algorithm: 'RSA-PSS-SHA256', value: Buffer.from(signed.signature as Uint8Array).toString('base64') } });
    await firestore.runTransaction(async (tx) => { const ref = firestore.doc(`v1_approval_assertions/${assertion.jti}`); const existing = await tx.get(ref); if (existing.exists) throw new Error('ASSERTION_REPLAY'); tx.create(ref, { assertion, status: 'ISSUED', issued_at: new Date().toISOString() }); });
    const headers = await new GoogleAuth().getIdTokenClient(controlUrl).then((client) => client.getRequestHeaders(`${controlUrl}/events/resume`));
    const response = await fetch(`${controlUrl}/events/resume`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ execution_id: body.execution_id, approval_id: match[1], assertion }) });
    if (!response.ok) throw new Error('CONTROL_REJECTED_ASSERTION');
    await firestore.doc(`v1_approval_assertions/${assertion.jti}`).set({ status: 'DELIVERED', delivered_at: new Date().toISOString() }, { merge: true });
    send(res, 200, { status: 'DELIVERED', assertion_jti: assertion.jti });
  } catch (error) { send(res, 403, { error: error instanceof Error ? error.message : 'AUTHORITY_REJECTED' }); }
}).listen(port, () => console.log(`[rb-authority] listening on ${port}`));
