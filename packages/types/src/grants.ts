import { z } from 'zod';

export const ActionGrantSchema = z.object({
  typ: z.literal('RB-ACTION-GRANT'),
  version: z.literal('0.1'),
  iss: z.literal('rb-control'),
  aud: z.literal('rb-broker'),
  jti: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  execution_id: z.string(),
  node_id: z.string(),
  node_attempt: z.number().int().min(1),
  capability: z.string(),
  params_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runbook_ir_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  manifest_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  trigger_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  lease_generation: z.number().int(),
  control_epoch: z.number().int(),
  authority_assertion_ids: z.array(z.string()).default([]),
});
export type ActionGrant = z.infer<typeof ActionGrantSchema>;

export const ApprovalAssertionSchema = z.object({
  typ: z.literal('RB-APPROVAL-ASSERTION'),
  version: z.literal('0.1'),
  iss: z.string(),
  sub: z.string(),
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string(),
  tenant_id: z.string(),
  authority_id: z.string(),
  execution_id: z.string(),
  runbook_ir_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  node_id: z.string(),
  trigger_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  target_scope_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decision: z.enum(['APPROVE', 'REJECT']),
});
export type ApprovalAssertion = z.infer<typeof ApprovalAssertionSchema>;
