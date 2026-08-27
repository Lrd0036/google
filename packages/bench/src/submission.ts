import { createHash } from 'node:crypto';
import type { DiagnosticArtifact, RBIRDocument } from '@runbook/types';
import { DiagnosticArtifactSchema, RBIRDocumentSchema } from '@runbook/types';

export type SubmissionProfile = 'SEMANTIC' | 'COMPILER' | 'END_TO_END';
export const RUNTIME_CHECKS = ['wrong_manifest_rejected','wrong_trigger_rejected','grant_replay_rejected','stale_lease_rejected','adversarial_authority_rejected'] as const;
export interface RuntimeEvidence { check: typeof RUNTIME_CHECKS[number]; status: 'PASS' | 'FAIL'; evidence_sha256: string; }
export interface BenchmarkSubmission {
  schema: 'runbookbench-submission/v0.1'; item_id: string; profile: SubmissionProfile; generated_at: string;
  identity: { compiler_version: string; compiler_build_sha256: string; source_sha256: string; manifest_sha256: string; prompt_profile_sha256: string; model_profile: string };
  disposition: 'COMPILED' | 'ABSTAINED'; abstention_reason?: string;
  diagnostics: DiagnosticArtifact; rbir?: RBIRDocument; runtime_evidence: RuntimeEvidence[];
}
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function submissionDigest(value: BenchmarkSubmission): string { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
export function validateSubmission(value: unknown): BenchmarkSubmission {
  if (!value || typeof value !== 'object') throw new Error('INCOMPLETE: submission must be an object');
  const input = value as Partial<BenchmarkSubmission>;
  if (input.schema !== 'runbookbench-submission/v0.1' || !input.item_id || !input.profile || !input.generated_at || Number.isNaN(Date.parse(input.generated_at))) throw new Error('INCOMPLETE: submission identity is missing');
  if (!input.identity || Object.values(input.identity).some((field) => !field) || ![input.identity.compiler_build_sha256,input.identity.source_sha256,input.identity.manifest_sha256,input.identity.prompt_profile_sha256].every((digest) => digestPattern.test(digest))) throw new Error('INCOMPLETE: submission digests are missing or invalid');
  if (input.disposition !== 'COMPILED' && input.disposition !== 'ABSTAINED') throw new Error('INCOMPLETE: disposition is required');
  if (input.disposition === 'COMPILED' && !input.rbir) throw new Error('INCOMPLETE: compiled submission requires RBIR');
  if (input.disposition === 'ABSTAINED' && (!input.abstention_reason || input.rbir)) throw new Error('INCOMPLETE: abstention requires a reason and no RBIR');
  DiagnosticArtifactSchema.parse(input.diagnostics);
  if (input.rbir) RBIRDocumentSchema.parse(input.rbir);
  const checks = new Map((input.runtime_evidence ?? []).map((entry) => [entry.check, entry]));
  for (const check of RUNTIME_CHECKS) { const evidence = checks.get(check); if (!evidence || !digestPattern.test(evidence.evidence_sha256)) throw new Error(`INCOMPLETE: runtime evidence '${check}' is required`); }
  return input as BenchmarkSubmission;
}
