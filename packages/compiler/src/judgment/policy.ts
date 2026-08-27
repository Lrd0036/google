import type { JudgmentInput } from './runtime.js';

/** TRANSIENT_UPSTREAM_FAILURE is representable only against these trusted statuses. */
export const TRANSIENT_HTTP_STATUSES = [408, 429, 500, 502, 503, 504] as const;

export type JudgmentPolicyReason = 'OK' | 'HTTP_STATUS_CONFLICT' | 'MISSING_TRUSTED_STATUS' | 'UNDECLARED_DECISION';

export interface JudgmentPolicyEvaluation {
  raw_decision: string;
  final_decision: string;
  schema_valid: boolean;
  decision_constraints_satisfied: boolean;
  reason: JudgmentPolicyReason;
  required_http_statuses?: number[];
  observed_http_status?: number;
}

function trustedHttpStatus(input: JudgmentInput): number | undefined {
  const evidence = input.trustedEvidence.find((item) => item.id === 'trusted:http_status' || item.id === 'http_status');
  return typeof evidence?.value === 'number' ? evidence.value : undefined;
}

/**
 * Deterministic constraint check. The model may emit any schema-valid decision;
 * this function decides whether that decision may traverse an ACTION edge.
 */
export function evaluateJudgmentPolicy(rawDecision: string, input: JudgmentInput, allowedDecisions?: readonly string[]): JudgmentPolicyEvaluation {
  const observed = trustedHttpStatus(input);
  const required = [...TRANSIENT_HTTP_STATUSES];
  if (allowedDecisions && !allowedDecisions.includes(rawDecision)) {
    return { raw_decision: rawDecision, final_decision: 'UNKNOWN', schema_valid: false, decision_constraints_satisfied: false, reason: 'UNDECLARED_DECISION', required_http_statuses: required, observed_http_status: observed };
  }
  if (rawDecision !== 'TRANSIENT_UPSTREAM_FAILURE') {
    return { raw_decision: rawDecision, final_decision: rawDecision, schema_valid: true, decision_constraints_satisfied: true, reason: 'OK', observed_http_status: observed };
  }
  if (typeof observed !== 'number') {
    return { raw_decision: rawDecision, final_decision: 'UNKNOWN', schema_valid: true, decision_constraints_satisfied: false, reason: 'MISSING_TRUSTED_STATUS', required_http_statuses: required };
  }
  if (!(TRANSIENT_HTTP_STATUSES as readonly number[]).includes(observed)) {
    return { raw_decision: rawDecision, final_decision: 'UNKNOWN', schema_valid: true, decision_constraints_satisfied: false, reason: 'HTTP_STATUS_CONFLICT', required_http_statuses: required, observed_http_status: observed };
  }
  return { raw_decision: rawDecision, final_decision: rawDecision, schema_valid: true, decision_constraints_satisfied: true, reason: 'OK', required_http_statuses: required, observed_http_status: observed };
}
