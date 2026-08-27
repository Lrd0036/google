import { z } from 'zod';

export const CapabilityModeSchema = z.enum(['READ', 'WRITE']);
export type CapabilityMode = z.infer<typeof CapabilityModeSchema>;

export const RiskTierSchema = z.enum([
  'R0_READ_ONLY',
  'R1_REVERSIBLE_LOW',
  'R2_DISRUPTIVE_MEDIUM',
  'R3_DESTRUCTIVE_HIGH',
]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const TransportSchema = z.object({
  type: z.enum(['HTTP', 'GRPC', 'PUBSUB', 'CLOUD_FUNCTION']),
  service: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  audience: z.string().optional(),
  allowed_host: z.string().optional(),
});
export type Transport = z.infer<typeof TransportSchema>;

export const IdempotencyPolicySchema = z.object({
  strategy: z.enum(['NATIVE_KEY', 'CLIENT_TOKEN', 'NATURALLY_IDEMPOTENT', 'NON_IDEMPOTENT']),
  header: z.string().optional(),
  same_key_replay_safe: z.boolean().optional(),
});
export type IdempotencyPolicy = z.infer<typeof IdempotencyPolicySchema>;

export const ApprovalFloorSchema = z.enum([
  'PREAPPROVED_RUNBOOK',
  'OPERATIONS_LEAD',
  'INCIDENT_COMMANDER',
  'MULTI_PARTY_QUORUM',
]);
export type ApprovalFloor = z.infer<typeof ApprovalFloorSchema>;

export const CapabilityDefinitionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  description: z.string(),
  semantic_actions: z.array(z.string()),
  mode: CapabilityModeSchema,
  risk: RiskTierSchema,
  transport: TransportSchema,
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()),
  timeout_ms: z.number().int().min(100),
  idempotency: IdempotencyPolicySchema,
  approval_floor: ApprovalFloorSchema,
  credential_profile: z.string(),
});
export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;

export const CapabilityManifestSchema = z.object({
  manifest_version: z.literal('rb-capabilities/v0.1'),
  id: z.string(),
  version: z.number().int().positive(),
  capabilities: z.array(CapabilityDefinitionSchema),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
