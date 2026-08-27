import { createServer } from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { dispatchActionGrant, BrokerError, CircuitBreaker, FirestoreExecutionFenceStore, FirestoreGrantReplayStore, FirestoreOperationStore, MemoryGrantReplayStore, MemoryOperationStore, MetricsRegistry } from './broker.js';

export * from './broker.js';

const port = Number(process.env.PORT || 8081);
const firestore = process.env.GCP_PROJECT || process.env.FIRESTORE_EMULATOR_HOST ? new Firestore({ projectId: process.env.GCP_PROJECT || 'runbook-local-dev' }) : undefined;
const store = firestore ? new FirestoreOperationStore(firestore) : new MemoryOperationStore();
const replayStore = firestore ? new FirestoreGrantReplayStore(firestore) : new MemoryGrantReplayStore();
const circuitBreakers = new Map<string, CircuitBreaker>();
const metrics = new MetricsRegistry();
const kms = process.env.KMS_KEY_VERSION ? new KeyManagementServiceClient() : undefined;
const requireAuthoritativeFence = process.env.REQUIRE_AUTHORITATIVE_FENCE === 'true';
if (requireAuthoritativeFence && !firestore) throw new Error('REQUIRE_AUTHORITATIVE_FENCE needs Firestore configuration');
const fenceStore = requireAuthoritativeFence && firestore ? new FirestoreExecutionFenceStore(firestore) : undefined;
const allowedOrigins = (process.env.ALLOWED_CAPABILITY_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const maxJsonBodyBytes = Number(process.env.MAX_JSON_BODY_BYTES || 1_048_576);

async function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxJsonBodyBytes) throw new BrokerError('REQUEST_BODY_TOO_LARGE', 'JSON request body exceeds the configured limit.', 413);
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'HEALTHY', service: 'rb-broker' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics.prometheus());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/dispatch') {
    try {
        const payload = await readJson(req);
        const grant = payload.grant as Record<string, unknown> | undefined;
        const breakerKey = typeof grant?.capability === 'string' ? grant.capability : 'unknown';
        const kmsPublicKey = kms && process.env.KMS_KEY_VERSION ? (await kms.getPublicKey({ name: process.env.KMS_KEY_VERSION }))[0].pem : undefined;
        const result = await dispatchActionGrant({
          grant,
          params: (payload.params ?? {}) as never,
          manifest: payload.manifest,
          lease: payload.lease as never,
          controlEpoch: Number(payload.control_epoch),
          publicKey: String(kmsPublicKey ?? payload.public_key ?? ''),
          expectedKeyId: process.env.BROKER_SIGNING_KEY_ID,
          store,
          replayStore,
          fenceStore,
          allowRequestCarriedFence: !requireAuthoritativeFence,
          allowedOrigins,
          metrics,
          circuitBreaker: circuitBreakers.get(breakerKey) ?? circuitBreakers.set(breakerKey, new CircuitBreaker()).get(breakerKey),
        });
        send(res, 200, result);
    } catch (error: unknown) {
      console.error('[rb-broker] dispatch error', error);
      if (error instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON payload' });
      if (error instanceof BrokerError) return send(res, error.status, { error: error.code, message: error.message });
      return send(res, 502, { error: 'CAPABILITY_INVOCATION_FAILED' });
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(port, () => {
  console.log(`[rb-broker] Action Broker PEP service running on port ${port}`);
});
