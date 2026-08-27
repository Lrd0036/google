import { createHash } from 'node:crypto';
import type { CapabilityManifest, RBIRDocument, RBIRNode, RBIREdge, AuthorityObject } from '@runbook/types';
import { CapabilityManifestSchema } from '@runbook/types';
import { lintRunbook, type LintResult } from './analyzer/linter.js';
import { RBIRBuilder } from './ir/builder.js';

export interface CompilePlan {
  runbook_id: string;
  version: number;
  tenant_id: string;
  entry_node: string;
  context_schema?: Record<string, unknown>;
  authority_model?: AuthorityObject[];
  nodes: RBIRNode[];
  edges: RBIREdge[];
}

export interface CompileResult {
  document: RBIRDocument;
  lint: LintResult;
}

export function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/**
 * Compile a deterministic, human-reviewed plan into RBIR. This is the local
 * seam used while prose extraction remains advisory; no model output becomes
 * an action binding here.
 */
export function compilePlan(sourceText: string, sourceUri: string, plan: CompilePlan, manifest: CapabilityManifest): CompileResult {
  CapabilityManifestSchema.parse(manifest);
  const document = new RBIRBuilder({
    runbookId: plan.runbook_id,
    version: plan.version,
    tenantId: plan.tenant_id,
    sourceUri,
    sourceSha256: sha256Text(sourceText),
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    manifestSha256: sha256Text(canonicalJson(manifest)),
    entryNode: plan.entry_node,
    contextSchema: plan.context_schema,
    authorityModel: plan.authority_model,
  });
  for (const node of plan.nodes) document.addNode(node);
  for (const edge of plan.edges) document.addEdge(edge);
  const built = document.build();
  return { document: built, lint: lintRunbook(built, { manifest }) };
}
