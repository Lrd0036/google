import { createServer } from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { auditObject } from './delivery.js';

export * from './delivery.js';
const firestore = new Firestore({ projectId: process.env.GCP_PROJECT ?? '' });
const storage = new Storage();
const bucket = process.env.AUDIT_BUCKET ?? '';
const port = Number(process.env.PORT ?? 8080);

async function deliverBatch(limit = 100): Promise<{ delivered: number; backlog: number }> {
  if (!bucket) throw new Error('AUDIT_BUCKET_REQUIRED');
  const pending = await firestore.collection('v1_audit_outbox').where('status', '==', 'PENDING').limit(limit).get();
  let delivered = 0;
  for (const document of pending.docs) {
    const record = document.data() as { event?: unknown };
    const object = auditObject(record.event);
    try {
      await storage.bucket(bucket).file(object.object).save(object.bytes, { resumable: false, contentType: 'application/json', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256: object.sha256 } } });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 412) throw error;
      const [existing] = await storage.bucket(bucket).file(object.object).download();
      if (!existing.equals(object.bytes)) throw new Error('AUDIT_OBJECT_COLLISION');
    }
    await document.ref.set({ status: 'DELIVERED', object: object.object, sha256: object.sha256, delivered_at: new Date().toISOString() }, { merge: true });
    delivered += 1;
  }
  const backlog = (await firestore.collection('v1_audit_outbox').where('status', '==', 'PENDING').count().get()).data().count;
  await firestore.doc('v1_system_health/audit_delivery').set({ status: backlog === 0 ? 'HEALTHY' : 'BACKLOG', backlog, checked_at: new Date().toISOString(), fresh_until: new Date(Date.now() + 60_000).toISOString(), archive_classification: 'retention-protected audit archive' });
  return { delivered, backlog };
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'HEALTHY', service: 'rb-audit-writer' })); return; }
  if (req.method === 'POST' && req.url === '/deliver') {
    try { const result = await deliverBatch(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); }
    catch (error) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'AUDIT_DELIVERY_FAILED' })); }
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`[rb-audit-writer] listening on ${port}`));
