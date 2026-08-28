import { z } from 'zod';

export const ExerciseStatusSchema = z.enum([
  'ARMED',
  'ATTACK_IN_PROGRESS',
  'DETERMINISTIC_MONITORING',
  'FLEET_INVESTIGATING',
  'AWAITING_APPROVAL',
  'RESTORING',
  'VERIFYING',
  'COMPLETED',
  'ESCALATED',
]);
export type ExerciseStatus = z.infer<typeof ExerciseStatusSchema>;

export const EvidenceTrustSchema = z.enum(['TRUSTED', 'UNTRUSTED', 'QUARANTINED', 'HYPOTHESIS_ONLY']);
export type EvidenceTrust = z.infer<typeof EvidenceTrustSchema>;

export const ExerciseEventSchema = z.object({
  event_id: z.string().min(1),
  exercise_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurred_at: z.string().datetime(),
  source: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
  trust: EvidenceTrustSchema,
  payload_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  previous_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  event_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  evidence_ids: z.array(z.string()).default([]),
}).strict();
export type ExerciseEvent = z.infer<typeof ExerciseEventSchema>;

export const CampaignFunnelSchema = z.object({
  received: z.literal(214),
  routine: z.literal(147),
  decoys: z.literal(39),
  correlated_anomalies: z.literal(17),
  causal_events: z.literal(7),
  authoritative_facts: z.literal(4),
}).strict();
export type CampaignFunnel = z.infer<typeof CampaignFunnelSchema>;

export const AttackFactSchema = z.object({
  fact_id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['PENDING', 'PROVEN']),
  evidence_ids: z.array(z.string()).min(1),
}).strict();
export type AttackFact = z.infer<typeof AttackFactSchema>;

export const AgentActivitySchema = z.object({
  activity_id: z.string().min(1),
  agent_id: z.string().min(1),
  agent_name: z.string().min(1),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'COMPROMISED']),
  summary: z.string().min(1),
  decision: z.string().optional(),
  evidence_ids: z.array(z.string()).default([]),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
}).strict();
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const ModelArmorVerdictSchema = z.object({
  verdict_event_id: z.string().min(1),
  template: z.string().min(1),
  invocation_result: z.enum(['SUCCESS', 'PARTIAL', 'FAILURE', 'UNAVAILABLE']),
  match_state: z.enum(['MATCH_FOUND', 'NO_MATCH_FOUND', 'UNAVAILABLE']),
  prompt_injection_confidence: z.string().optional(),
  trace_id: z.string().min(1),
  recorded_at: z.string().datetime(),
}).strict();
export type ModelArmorVerdict = z.infer<typeof ModelArmorVerdictSchema>;

export const ProcessObservationSchema = z.object({
  observed_at: z.string().datetime(),
  pump_state: z.enum(['ENERGIZED', 'DE_ENERGIZED']),
  independent_pressure_psi: z.number().finite(),
  operator_pressure_psi: z.number().finite(),
  remote_write_path: z.enum(['AVAILABLE', 'CONTAINED']),
  evidence_preserved: z.boolean(),
  restoration_prepared: z.boolean(),
}).strict();
export type ProcessObservation = z.infer<typeof ProcessObservationSchema>;

export const ProvenanceItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  status: z.enum(['VERIFIED', 'UNAVAILABLE', 'FAILED']),
  source: z.string().min(1),
  checked_at: z.string().datetime(),
  href: z.string().url().optional(),
}).strict();
export type ProvenanceItem = z.infer<typeof ProvenanceItemSchema>;

export const IncidentReportBundleSchema = z.object({
  schema: z.literal('royal-duke-incident-report/v1'),
  exercise_id: z.string().min(1),
  generated_at: z.string().datetime(),
  status: z.enum(['COMPLETED', 'ESCALATED']),
  title: z.string().min(1),
  executive_summary: z.string().min(1),
  attack_facts: z.array(AttackFactSchema),
  event_ids: z.array(z.string()),
  actions: z.array(z.object({ capability: z.string(), outcome: z.string(), evidence_ids: z.array(z.string()) }).strict()),
  approval: z.object({ required: z.literal(true), principal: z.string().optional(), decision: z.enum(['APPROVE', 'REJECT']).optional(), assertion_id: z.string().optional() }).strict(),
  verification: z.object({ threshold_psi: z.literal(58), stable_seconds: z.literal(30), outcome: z.enum(['PASS', 'FAIL']), evidence_ids: z.array(z.string()) }).strict(),
  model_security: z.object({ shadow_decision: z.string(), authoritative_decision: z.string(), verdict_event_id: z.string(), quarantined_evidence_ids: z.array(z.string()) }).strict(),
  trace_id: z.string().min(1),
  event_chain_valid: z.boolean(),
  report_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  limitations: z.array(z.string()),
}).strict();
export type IncidentReportBundle = z.infer<typeof IncidentReportBundleSchema>;

export const RoyalDukeExerciseSchema = z.object({
  schema: z.literal('royal-duke-exercise/v1'),
  exercise_id: z.string().min(1),
  range_run_id: z.string().min(1),
  status: ExerciseStatusSchema,
  started_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  trace_id: z.string().min(1),
  attack_actions: z.array(z.string()),
  campaign: CampaignFunnelSchema,
  facts: z.array(AttackFactSchema),
  activities: z.array(AgentActivitySchema),
  events: z.array(ExerciseEventSchema),
  latest_observation: ProcessObservationSchema.optional(),
  divergence_started_at: z.string().datetime().optional(),
  divergence_elapsed_seconds: z.number().nonnegative(),
  recovery_started_at: z.string().datetime().optional(),
  recovery_elapsed_seconds: z.number().nonnegative(),
  injected_evidence: z.object({ evidence_id: z.string(), text: z.string(), trust: EvidenceTrustSchema }).optional(),
  model_armor: ModelArmorVerdictSchema.optional(),
  shadow_decision: z.string().optional(),
  authoritative_decision: z.string().optional(),
  pending_approval: z.object({ approval_id: z.string(), role: z.literal('duty-plant-operator'), proposed_action: z.literal('restore_pump@1'), created_at: z.string().datetime() }).optional(),
  approval: z.object({ decision: z.enum(['APPROVE', 'REJECT']), principal: z.string(), assertion_id: z.string(), decided_at: z.string().datetime() }).optional(),
  report: IncidentReportBundleSchema.optional(),
}).strict();
export type RoyalDukeExercise = z.infer<typeof RoyalDukeExerciseSchema>;
