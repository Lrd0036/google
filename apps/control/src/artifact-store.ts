import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { RBIRDocumentSchema, type RBIRDocument } from '@runbook/types';

export interface AdmittedArtifact {
  id: string;
  bucket: string;
  object: string;
  generation: string;
  rbir_sha256: string;
  manifest_sha256: string;
  compiler_identity: string;
  admitted_at: string;
  status: 'ADMITTED' | 'REVOKED';
}

export function verifyArtifactBytes(bytes: Buffer, admission: AdmittedArtifact): RBIRDocument {
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (admission.status !== 'ADMITTED' || digest !== admission.rbir_sha256) throw new Error('ARTIFACT_DIGEST_MISMATCH');
  const document = RBIRDocumentSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (document.capability_manifest.capability_manifest_sha256 !== admission.manifest_sha256) throw new Error('ARTIFACT_MANIFEST_MISMATCH');
  return document;
}

export class ArtifactAdmissionStore {
  private readonly storage = new Storage();
  constructor(private readonly firestore: Firestore, private readonly admissionBucket?: string) {}

  async admit(documentInput: unknown, manifestSha256: string, compilerIdentity: string): Promise<AdmittedArtifact> {
    if (!this.admissionBucket) throw new Error('ARTIFACT_BUCKET_REQUIRED');
    const document = RBIRDocumentSchema.parse(documentInput);
    if (document.capability_manifest.capability_manifest_sha256 !== manifestSha256) throw new Error('ARTIFACT_MANIFEST_MISMATCH');
    const bytes = Buffer.from(JSON.stringify(document));
    const rbirSha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const id = rbirSha256.slice('sha256:'.length);
    const object = `sha256/${id}.rbir.json`;
    const file = this.storage.bucket(this.admissionBucket).file(object);
    await file.save(bytes, { contentType: 'application/json', resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { rbir_sha256: rbirSha256, manifest_sha256: manifestSha256, compiler_identity: compilerIdentity } } });
    const [metadata] = await file.getMetadata();
    const admission: AdmittedArtifact = { id, bucket: this.admissionBucket, object, generation: String(metadata.generation), rbir_sha256: rbirSha256, manifest_sha256: manifestSha256, compiler_identity: compilerIdentity, admitted_at: new Date().toISOString(), status: 'ADMITTED' };
    await this.firestore.doc(`v1_admitted_artifacts/${id}`).create(admission);
    return admission;
  }

  async load(id: string): Promise<{ admission: AdmittedArtifact; document: RBIRDocument }> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(id)) throw new Error('INVALID_ARTIFACT_ID');
    const snapshot = await this.firestore.doc(`v1_admitted_artifacts/${id}`).get();
    if (!snapshot.exists) throw new Error('ARTIFACT_NOT_ADMITTED');
    const admission = snapshot.data() as AdmittedArtifact;
    const [bytes] = await this.storage.bucket(admission.bucket).file(admission.object, { generation: Number(admission.generation) }).download();
    return { admission, document: verifyArtifactBytes(bytes, admission) };
  }
}
