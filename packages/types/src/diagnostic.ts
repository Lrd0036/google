import { z } from 'zod';

export const DiagnosticSeveritySchema = z.enum(['ERROR', 'WARNING', 'INFO']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

export const DiagnosticCategorySchema = z.enum([
  'SYNTAX',
  'AMBIGUOUS_PREDICATE',
  'UNBOUNDED_RETRY',
  'CONTRADICTORY_POLICY',
  'UNVERIFIED_MUTATION',
  'DEAD_END_OR_UNREACHABLE',
  'UNKNOWN_CAPABILITY',
  'TYPE_MISMATCH',
  'AUTHORITY_ESCALATION',
  'FORBIDDEN_MUTATION',
  'UNSAFE_VERIFICATION',
]);
export type DiagnosticCategory = z.infer<typeof DiagnosticCategorySchema>;

export const SourcePositionSchema = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
  byte: z.number().int().min(0),
});
export type SourcePosition = z.infer<typeof SourcePositionSchema>;

export const SourceSpanSchema = z.object({
  uri: z.string(),
  start: SourcePositionSchema,
  end: SourcePositionSchema,
});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export const SuggestedFixSchema = z.object({
  kind: z.enum(['SOURCE_PATCH', 'CAPABILITY_UPGRADE', 'HUMAN_ESCALATION']),
  advisory_only: z.literal(true),
  replacement: z.string(),
  confidence: z.number().min(0).max(1),
});
export type SuggestedFix = z.infer<typeof SuggestedFixSchema>;

export const DiagnosticItemSchema = z.object({
  code: z.string().regex(/^RBK-[1-9][0-9]{2}$/),
  severity: DiagnosticSeveritySchema,
  category: DiagnosticCategorySchema,
  message: z.string(),
  statement_id: z.string(),
  related_node: z.string().optional(),
  source: SourceSpanSchema,
  required_resolution: z.array(z.string()),
  suggested_fix: SuggestedFixSchema.optional(),
});
export type DiagnosticItem = z.infer<typeof DiagnosticItemSchema>;

export const DiagnosticArtifactSchema = z.object({
  diagnostic_version: z.literal('rb-diagnostic/v0.1'),
  diagnostics: z.array(DiagnosticItemSchema),
});
export type DiagnosticArtifact = z.infer<typeof DiagnosticArtifactSchema>;
