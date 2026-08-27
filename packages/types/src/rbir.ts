import { z } from 'zod';
import { AuthorityObjectSchema } from './authority.js';

export const NodeKindSchema = z.enum([
  'DETERMINISTIC',
  'AGENT_JUDGMENT',
  'ACTION',
  'HUMAN_APPROVAL',
  'VERIFY',
  'TERMINAL',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const TerminalStatusSchema = z.enum([
  'RESOLVED',
  'HALTED',
  'ESCALATED',
  'MANUAL_INTERVENTION_REQUIRED',
  'COMPENSATED',
  'HALTED_UNMAPPED_STATE',
  'ESCALATED_TO_HUMAN',
  'POLICY_VIOLATION',
  'FAILED_VERIFICATION',
  'TIMED_OUT',
  'CANCELLED',
]);
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

export const ActionNodePayloadSchema = z.object({
  capability: z.string(),
  parameters: z.record(z.unknown()),
  idempotency_key: z.string().optional(),
  compensation_node: z.string().optional(),
}).strict();
export type ActionNodePayload = z.infer<typeof ActionNodePayloadSchema>;

export const JudgmentNodePayloadSchema = z.object({
  model_profile: z.string().default('RBK_CLASSIFIER_V1'),
  prompt_template: z.string(),
  allowed_enum: z.array(z.string()),
}).strict();
export type JudgmentNodePayload = z.infer<typeof JudgmentNodePayloadSchema>;

export const ApprovalNodePayloadSchema = z.object({
  role: z.string(),
  quorum: z.number().int().min(1).default(1),
  timeout_ms: z.number().int().positive().optional(),
}).strict();
export type ApprovalNodePayload = z.infer<typeof ApprovalNodePayloadSchema>;

export const VerifyNodePayloadSchema = z.object({
  target_action_node: z.string(),
  capability: z.string(),
  expected_state: z.record(z.unknown()),
}).strict();
export type VerifyNodePayload = z.infer<typeof VerifyNodePayloadSchema>;

export const TerminalNodePayloadSchema = z.object({
  status: TerminalStatusSchema,
  reason: z.string(),
  reason_code: z.string().optional(),
}).strict();
export type TerminalNodePayload = z.infer<typeof TerminalNodePayloadSchema>;

export const LoopMetadataSchema = z.object({
  loop_id: z.string(),
  max_iterations: z.number().int().positive().optional(),
  deadline_ms: z.number().int().positive().optional(),
  retryable_outcomes: z.array(z.string()).min(1).optional(),
  non_retryable_outcomes: z.array(z.string()).min(1).optional(),
  backoff: z.object({ type: z.enum(['FIXED', 'EXPONENTIAL']), initial_ms: z.number().int().positive(), max_ms: z.number().int().positive() }).strict().optional(),
}).strict();
export type LoopMetadata = z.infer<typeof LoopMetadataSchema>;

export const RBIRNodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  description: z.string(),
  statement_ids: z.array(z.string()).default([]),
  timeout_ms: z.number().int().min(0).optional(),
  outcomes: z.array(z.string()),
  action: ActionNodePayloadSchema.optional(),
  judgment: JudgmentNodePayloadSchema.optional(),
  approval: ApprovalNodePayloadSchema.optional(),
  verify: VerifyNodePayloadSchema.optional(),
  terminal: TerminalNodePayloadSchema.optional(),
  loop: LoopMetadataSchema.optional(),
}).strict().superRefine((node, ctx) => {
  const payloadByKind = {
    ACTION: node.action,
    AGENT_JUDGMENT: node.judgment,
    HUMAN_APPROVAL: node.approval,
    VERIFY: node.verify,
    TERMINAL: node.terminal,
  } as const;
  const expected = payloadByKind[node.kind as keyof typeof payloadByKind];
  if (node.kind !== 'DETERMINISTIC' && !expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${node.kind} node requires its matching payload` });
  }
  if (node.kind === 'DETERMINISTIC' && (node.action || node.judgment || node.approval || node.verify || node.terminal)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DETERMINISTIC nodes cannot declare an execution payload' });
  }
});
export type RBIRNode = z.infer<typeof RBIRNodeSchema>;

export const RBIREdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  on: z.string(),
  to: z.string(),
}).strict();
export type RBIREdge = z.infer<typeof RBIREdgeSchema>;

export const RBIRDocumentSchema = z.object({
  ir_version: z.literal('rbir/v0.1'),
  runbook: z.object({
    id: z.string(),
    version: z.number().int().positive(),
    compiled_at: z.string().datetime(),
    compiler_version: z.string(),
    tenant_id: z.string(),
  }).strict(),
  source: z.object({
    uri: z.string(),
    source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
  capability_manifest: z.object({
    id: z.string(),
    version: z.number().int().positive(),
    capability_manifest_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
  entry_node: z.string(),
  context_schema: z.record(z.unknown()),
  authority_model: z.array(AuthorityObjectSchema),
  obligations: z.array(z.record(z.unknown())).default([]),
  policy_constraints: z.array(z.record(z.unknown())).default([]),
  nodes: z.array(RBIRNodeSchema),
  edges: z.array(RBIREdgeSchema),
}).strict();
export type RBIRDocument = z.infer<typeof RBIRDocumentSchema>;
