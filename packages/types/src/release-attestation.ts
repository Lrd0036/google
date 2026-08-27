import { z } from 'zod';
import { RiskTierSchema } from './manifest.js';

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GateNameSchema = z.enum([
  'corpus_provenance',
  'annotations',
  'benchmark',
  'console',
  'identity',
  'authority',
  'artifacts',
  'audit',
  'negative_security',
  'backup_restore',
  'alerting',
]);

export const ReleaseGateEvidenceSchema = z.object({
  status: z.enum(['PASS', 'FAIL']),
  evidence_sha256: Sha256Schema,
  observed_at: z.string().datetime(),
});

const GatesSchema = z.record(GateNameSchema, ReleaseGateEvidenceSchema).superRefine((gates, context) => {
  for (const name of GateNameSchema.options) {
    if (!(name in gates)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing release gate ${name}` });
  }
});

export const UnsignedReleaseAttestationSchema = z.object({
  profile: z.literal('controlled-cloud-reenable/v0.1'),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  project_id: z.string().min(1),
  region: z.string().min(1),
  release: z.object({
    image_digests: z.record(z.string(), Sha256Schema),
    terraform_plan_sha256: Sha256Schema,
    state_schema: z.literal('runtime/v1'),
  }),
  benchmark: z.object({
    corpus_sha256: Sha256Schema,
    submission_sha256: Sha256Schema,
    report_sha256: Sha256Schema,
  }),
  allowed_execution: z.object({
    manifest_sha256: Sha256Schema,
    capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*@[1-9][0-9]*$/)).min(1),
    maximum_risk: RiskTierSchema,
  }),
  gates: GatesSchema,
  eligible: z.boolean(),
}).superRefine((attestation, context) => {
  const issued = Date.parse(attestation.issued_at);
  const expires = Date.parse(attestation.expires_at);
  if (expires <= issued || expires - issued > 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Release attestation validity must be greater than zero and no longer than 24 hours.' });
  }
  const allPass = GateNameSchema.options.every((name) => attestation.gates[name]?.status === 'PASS');
  if (attestation.eligible !== allPass) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'eligible must be derived from all required release gates.' });
  }
});

export const ReleaseAttestationSchema = UnsignedReleaseAttestationSchema.and(z.object({
  signature: z.object({
    algorithm: z.literal('RSA-PSS-SHA256'),
    key_id: z.string().min(1),
    value: z.string().min(1),
  }),
}));

export type ReleaseGateName = z.infer<typeof GateNameSchema>;
export type UnsignedReleaseAttestation = z.infer<typeof UnsignedReleaseAttestationSchema>;
export type ReleaseAttestation = z.infer<typeof ReleaseAttestationSchema>;
export const REQUIRED_RELEASE_GATES = GateNameSchema.options;
