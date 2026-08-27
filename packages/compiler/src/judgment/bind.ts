import type { RBIRNode } from '@runbook/types';
import { AgentJudgmentClassifier, type JudgmentInput } from './runtime.js';
import { evaluateJudgmentPolicy } from './policy.js';
import type { GeminiTransport } from '../semantic/extraction.js';

export type RuntimeJudgmentFn = (node: RBIRNode, context: Record<string, unknown>) => Promise<string>;

function asEvidenceId(prefix: 'trusted' | 'untrusted', id: string): string {
  return id.startsWith(`${prefix}:`) ? id : `${prefix}:${id}`;
}

function recordMap(prefix: 'trusted' | 'untrusted', value: unknown, into: Array<{ id: string; value: unknown }>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) into.push({ id: asEvidenceId(prefix, id), value: item });
}

/** Map execution context into trusted observations vs untrusted text. */
export function evidenceFromContext(context: Record<string, unknown>): JudgmentInput {
  const trusted: JudgmentInput['trustedEvidence'] = [];
  const untrusted: NonNullable<JudgmentInput['untrustedEvidence']> = [];
  if (typeof context.http_status === 'number') trusted.push({ id: 'trusted:http_status', value: context.http_status });
  if (typeof context.job_id === 'string') trusted.push({ id: 'trusted:job_id', value: context.job_id });
  if (typeof context.error_code === 'string') trusted.push({ id: 'trusted:error_code', value: context.error_code });
  recordMap('trusted', context.trusted_evidence, trusted);
  if (typeof context.log_excerpt === 'string') untrusted.push({ id: 'untrusted:log', value: context.log_excerpt });
  if (typeof context.untrusted_evidence === 'string') untrusted.push({ id: 'untrusted:blob', value: context.untrusted_evidence });
  if (Array.isArray(context.untrusted_evidence)) {
    for (const item of context.untrusted_evidence) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        const record = item as { id: string; value: unknown };
        untrusted.push({ id: record.id, value: record.value });
      }
    }
  } else recordMap('untrusted', context.untrusted_evidence, untrusted);
  const seen = new Set<string>();
  return {
    trustedEvidence: trusted.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }),
    untrustedEvidence: untrusted.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }),
  };
}

export function modelJudgmentFromContext(context: Record<string, unknown>): string | undefined {
  const recorded = context.model_judgment;
  if (recorded && typeof recorded === 'object' && typeof (recorded as { decision?: unknown }).decision === 'string') return (recorded as { decision: string }).decision;
  if (typeof context.judgment === 'string') return context.judgment;
  if (typeof context.failure_mode === 'string') return context.failure_mode;
  return undefined;
}

/** Bind AGENT_JUDGMENT to a transport. Returns the model's schema-valid decision; policy is applied by the runtime. */
export function createAgentJudgmentFn(transport: GeminiTransport): RuntimeJudgmentFn {
  return async (node, context) => {
    const allowed = [...new Set([...(node.judgment?.allowed_enum ?? node.outcomes), 'UNKNOWN'])];
    const classifier = new AgentJudgmentClassifier(transport, allowed);
    const result = await classifier.classify(evidenceFromContext(context));
    context.model_judgment = { decision: result.decision, confidence: result.confidence, evidence_ids: result.evidence_ids, schema_valid: true };
    return result.decision;
  };
}

export function applyJudgmentPolicy(rawDecision: string, context: Record<string, unknown>, allowedOutcomes: readonly string[]): string {
  const evaluation = evaluateJudgmentPolicy(rawDecision, evidenceFromContext(context), allowedOutcomes);
  context.policy_evaluation = evaluation;
  context.judgment_raw = evaluation.raw_decision;
  const outcome = allowedOutcomes.includes(evaluation.final_decision)
    ? evaluation.final_decision
    : (allowedOutcomes.includes('UNKNOWN') ? 'UNKNOWN' : evaluation.final_decision);
  context.judgment_result = outcome;
  return outcome;
}
