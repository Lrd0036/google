import { createHash } from 'node:crypto';
import { liveGeminiLocation, liveGeminiModel, RUNTIME_CLASSIFIER_PROMPT, JUDGMENT_OUTPUT_SCHEMA } from '../packages/compiler/dist/index.js';

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256Json(value) {
  return sha256Text(canonicalJson(value));
}

export function judgmentProof(input) {
  const context = input.execution.context ?? {};
  const model = context.model_judgment && typeof context.model_judgment === 'object' ? context.model_judgment : undefined;
  const policy = context.policy_evaluation && typeof context.policy_evaluation === 'object' ? context.policy_evaluation : undefined;
  const executed = Array.isArray(context.executed_capabilities) ? context.executed_capabilities : [];
  const live = String(input.evidence_mode).startsWith('LIVE_GEMINI');
  const vertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === '1' || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || process.env.GOOGLE_GENAI_USE_ENTERPRISE === '1';
  return {
    schema: 'runbook-compiler-proof/v0.1',
    generated_at: new Date().toISOString(),
    evidence_mode: input.evidence_mode,
    mutation_authority: 'LOCAL_MOCK_MUTATION_GATE',
    model: live
      ? { provider: vertex ? 'vertex-ai' : 'gemini-api', model: liveGeminiModel(), location: liveGeminiLocation() }
      : { provider: 'injected', model: 'schema-valid-judgment-fixture' },
    artifacts: {
      source_sha256: sha256Text(input.source),
      rbir_sha256: sha256Json(input.document),
      manifest_sha256: sha256Json(input.manifest),
      prompt_contract_sha256: sha256Text(RUNTIME_CLASSIFIER_PROMPT),
      output_schema_sha256: sha256Json(JUDGMENT_OUTPUT_SCHEMA),
    },
    input: {
      trusted_evidence: input.context.trusted_evidence ?? { http_status: input.context.http_status, error_code: input.context.error_code },
      untrusted_evidence: { contains_adversarial_instruction: input.contains_adversarial_instruction === true },
    },
    judgment: model
      ? { decision: model.decision, confidence: model.confidence, evidence_ids: model.evidence_ids, schema_valid: model.schema_valid !== false }
      : { decision: context.judgment_raw ?? context.judgment_result, schema_valid: true },
    policy_evaluation: policy ?? { decision_constraints_satisfied: null, reason: 'NOT_RECORDED' },
    authority: {
      requested_capabilities: [],
      authorized_capabilities: executed,
      executed_capabilities: executed,
    },
    execution: {
      status: input.execution.status,
      current_node: input.execution.current_node,
      trace: input.execution.trace,
    },
  };
}
