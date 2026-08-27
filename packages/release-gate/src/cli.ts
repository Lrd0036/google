#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Firestore } from '@google-cloud/firestore';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { Storage } from '@google-cloud/storage';
import { evaluateRelease, type GateEvidence, type ReleaseDescriptor } from './index.js';

function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`; }
function argument(name: string): string { const index = process.argv.indexOf(name); const value = index >= 0 ? process.argv[index + 1] : undefined; if (!value) throw new Error(`Missing ${name}`); return value; }

async function main() {
  const descriptor = JSON.parse(readFileSync(argument('--descriptor'), 'utf8')) as ReleaseDescriptor;
  const evidence = JSON.parse(readFileSync(argument('--evidence'), 'utf8')) as GateEvidence[];
  const keyVersion = argument('--kms-key-version');
  const bucketName = argument('--bucket');
  const attestation = evaluateRelease(descriptor, evidence);
  const digest = createHash('sha256').update(canonical(attestation)).digest();
  const [signed] = await new KeyManagementServiceClient().asymmetricSign({ name: keyVersion, digest: { sha256: digest } });
  const document = { ...attestation, signature: { algorithm: 'RSA-PSS-SHA256', key_id: keyVersion, value: Buffer.from(signed.signature as Uint8Array).toString('base64') } };
  const bytes = Buffer.from(JSON.stringify(document));
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const object = `sha256/${sha256.slice(7)}.release.json`;
  const file = new Storage().bucket(bucketName).file(object);
  await file.save(bytes, { contentType: 'application/json', resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { sha256, profile: attestation.profile } } });
  const [metadata] = await file.getMetadata();
  if (attestation.eligible) {
    await new Firestore({ projectId: attestation.project_id }).doc('v1_release_state/controlled-cloud-reenable-v0.1').set({ status: 'ACTIVE', bucket: bucketName, object, generation: String(metadata.generation), sha256, activated_at: new Date().toISOString() });
  }
  process.stdout.write(`${JSON.stringify({ eligible: attestation.eligible, activated: attestation.eligible, sha256, bucket: bucketName, object, generation: String(metadata.generation) }, null, 2)}\n`);
  if (!attestation.eligible) process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
