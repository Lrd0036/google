import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { CapabilityManifestSchema, RBIRDocumentSchema } from '@runbook/types';
import type { RBIRNode } from '@runbook/types';
import { executeLocally, type LocalExecutionResult } from './local-executor.js';
import { GoogleAuth } from 'google-auth-library';
import { KeyManagementServiceClient } from '@google-cloud/kms';

export interface LocalOrchestrationOptions {
  brokerUrl: string;
  fetchImpl?: typeof fetch;
  executionId?: string;
  triggerSha256?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export async function executeOverBroker(documentInput: unknown, manifestInput: unknown, context: Record<string, unknown>, options: LocalOrchestrationOptions): Promise<LocalExecutionResult> {
  const document = RBIRDocumentSchema.parse(documentInput);
  const manifest = CapabilityManifestSchema.parse(manifestInput);
  const fetchImpl = options.fetchImpl ?? fetch;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const kmsKeyVersion = process.env.KMS_KEY_VERSION;
  const kms = kmsKeyVersion ? new KeyManagementServiceClient() : undefined;
  const executionId = options.executionId ?? `local-http-${Date.now()}`;
  const triggerSha256 = options.triggerSha256 ?? sha256('local-trigger');

  const dispatch = async (node: RBIRNode, params: Record<string, unknown>, attempt: number) => {
    const capability = node.kind === 'ACTION' ? node.action?.capability : node.verify?.capability;
    if (!capability) throw new Error(`MISSING_CAPABILITY:${node.id}`);
    const now = Math.floor(Date.now() / 1000);
    const unsigned = {
      typ: 'RB-ACTION-GRANT' as const, version: '0.1' as const, iss: 'rb-control' as const, aud: 'rb-broker' as const,
      jti: `${executionId}-${node.id}-${attempt}-${now}`, iat: now, exp: now + 60, execution_id: executionId, node_id: node.id,
      node_attempt: attempt, capability, params_sha256: sha256(params), runbook_ir_sha256: document.source.source_sha256,
      manifest_sha256: sha256(manifest), trigger_sha256: triggerSha256, lease_generation: 1, control_epoch: 1, authority_assertion_ids: [],
    };
    const payload = Buffer.from(canonicalJson(unsigned));
    const value = kms && kmsKeyVersion
      ? Buffer.from((await kms.asymmetricSign({ name: kmsKeyVersion, digest: { sha256: createHash('sha256').update(payload).digest() } }))[0].signature ?? []).toString('base64')
      : sign('sha256', payload, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64');
    const brokerEndpoint = `${options.brokerUrl.replace(/\/$/, '')}/dispatch`;
    const identityHeaders = process.env.GCP_SERVICE_AUTH === 'true' && !options.fetchImpl
      ? await new GoogleAuth().getIdTokenClient(options.brokerUrl).then((client) => client.getRequestHeaders(brokerEndpoint))
      : {};
    const response = await fetchImpl(brokerEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', ...identityHeaders },
      body: JSON.stringify({ grant: { ...unsigned, signature: { algorithm: 'RSA-PSS-SHA256', key_id: kmsKeyVersion ?? 'local-control', value } }, params, manifest, lease: { owner: 'local-control', generation: 1, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString() }, control_epoch: 1, ...(kmsKeyVersion ? {} : { public_key: publicKeyPem }) }),
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `BROKER_HTTP_${response.status}`);
    return { status: String(body.status), response: body.response, operation_id: typeof body.operation_id === 'string' ? body.operation_id : undefined };
  };
  return executeLocally(document, context, dispatch);
}
