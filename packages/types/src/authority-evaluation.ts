import type { AuthorityObject } from './authority.js';

export interface AuthorityRequest {
  tenant_id: string;
  subject_id?: string;
  role?: string;
  permission: string;
  incident_id?: string;
  jurisdiction?: string;
  resource_scope?: string;
  trigger_sha256?: string;
  now?: Date;
  usage_counts?: Record<string, number>;
}

export interface AuthorityDecision {
  allowed: boolean;
  authority_ids: string[];
  denials: Array<{ authority_id: string; reason: string }>;
}

/** Deterministic ABAC evaluation. It only evaluates supplied authority; it never creates or escalates it. */
export function evaluateAuthority(authorities: AuthorityObject[], request: AuthorityRequest): AuthorityDecision {
  const authority_ids: string[] = [];
  const denials: Array<{ authority_id: string; reason: string }> = [];
  const now = request.now ?? new Date();
  for (const authority of authorities) {
    const deny = (reason: string) => denials.push({ authority_id: authority.authority_id, reason });
    if (authority.grantee.tenant_id !== request.tenant_id) { deny('TENANT_MISMATCH'); continue; }
    if (authority.grantee.subject_id && authority.grantee.subject_id !== request.subject_id) { deny('SUBJECT_MISMATCH'); continue; }
    if (authority.grantee.role !== request.role) { deny('ROLE_MISMATCH'); continue; }
    if (!authority.permissions.includes(request.permission)) { deny('PERMISSION_NOT_GRANTED'); continue; }
    const constraints = authority.constraints;
    if (constraints?.incident_id && constraints.incident_id !== request.incident_id) { deny('INCIDENT_MISMATCH'); continue; }
    if (constraints?.jurisdictions && (!request.jurisdiction || !constraints.jurisdictions.includes(request.jurisdiction))) { deny('JURISDICTION_MISMATCH'); continue; }
    if (constraints?.resource_scopes && (!request.resource_scope || !constraints.resource_scopes.includes(request.resource_scope))) { deny('RESOURCE_SCOPE_MISMATCH'); continue; }
    if (constraints?.trigger_sha256 && constraints.trigger_sha256 !== request.trigger_sha256) { deny('TRIGGER_MISMATCH'); continue; }
    if (constraints?.valid_from && now < new Date(constraints.valid_from)) { deny('NOT_YET_VALID'); continue; }
    if (constraints?.valid_until && now >= new Date(constraints.valid_until)) { deny('EXPIRED'); continue; }
    if (constraints?.max_uses !== undefined && (request.usage_counts?.[authority.authority_id] ?? 0) >= constraints.max_uses) { deny('MAX_USES_EXCEEDED'); continue; }
    authority_ids.push(authority.authority_id);
  }
  return { allowed: authority_ids.length > 0, authority_ids, denials };
}
