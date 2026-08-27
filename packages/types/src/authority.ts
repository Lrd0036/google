import { z } from 'zod';

export const AuthorityBasisSchema = z.enum(['STATUTORY', 'DELEGATED', 'ADMINISTRATIVE']);
export type AuthorityBasis = z.infer<typeof AuthorityBasisSchema>;

export const AuthoritySubjectSchema = z.object({
  tenant_id: z.string(),
  subject_id: z.string().optional(),
  role: z.string(),
});
export type AuthoritySubject = z.infer<typeof AuthoritySubjectSchema>;

export const AuthorityConstraintsSchema = z.object({
  incident_id: z.string().optional(),
  jurisdictions: z.array(z.string()).optional(),
  resource_scopes: z.array(z.string()).optional(),
  trigger_sha256: z.string().optional(),
  valid_from: z.string().datetime().optional(),
  valid_until: z.string().datetime().optional(),
  max_uses: z.number().int().positive().optional(),
});
export type AuthorityConstraints = z.infer<typeof AuthorityConstraintsSchema>;

export const AuthorityObjectSchema = z.object({
  authority_id: z.string(),
  basis: AuthorityBasisSchema,
  issuer: AuthoritySubjectSchema,
  grantee: AuthoritySubjectSchema,
  permissions: z.array(z.string()),
  constraints: AuthorityConstraintsSchema.optional(),
  delegation_chain: z.array(z.string()).optional(),
  non_delegable: z.boolean().default(false),
  source: z
    .object({
      document_sha256: z.string(),
      statement_id: z.string(),
      locator: z.string(),
    })
    .optional(),
});
export type AuthorityObject = z.infer<typeof AuthorityObjectSchema>;
