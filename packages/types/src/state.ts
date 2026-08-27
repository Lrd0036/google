import { z } from 'zod';

export const ExecutionStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUSPENDED_APPROVAL',
  'WAITING_VERIFY',
  'COMPLETED',
  'HALTED',
  'FAILED',
  'COMPENSATING',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionLeaseSchema = z.object({
  owner: z.string(),
  generation: z.number().int().min(1),
  acquired_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});
export type ExecutionLease = z.infer<typeof ExecutionLeaseSchema>;

export const ExecutionRecordSchema = z.object({
  execution_id: z.string(),
  tenant_id: z.string(),
  runbook_id: z.string(),
  runbook_version: z.number().int().positive(),
  ir_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  state_version: z.number().int().min(1),
  status: ExecutionStatusSchema,
  lease: ExecutionLeaseSchema,
  current_node: z.string(),
  context: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;
