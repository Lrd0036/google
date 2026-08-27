import type { RBIRDocument, RBIRNode, RBIREdge, AuthorityObject } from '@runbook/types';
import { RBIRDocumentSchema } from '@runbook/types';

export interface RBIRBuilderOptions {
  runbookId: string;
  version: number;
  tenantId: string;
  sourceUri: string;
  sourceSha256: string;
  manifestId: string;
  manifestVersion: number;
  manifestSha256: string;
  entryNode: string;
  contextSchema?: Record<string, unknown>;
  authorityModel?: AuthorityObject[];
}

export class RBIRBuilder {
  private nodes: RBIRNode[] = [];
  private edges: RBIREdge[] = [];

  constructor(private readonly options: RBIRBuilderOptions) {}

  public addNode(node: RBIRNode): this {
    this.nodes.push(node);
    return this;
  }

  public addEdge(edge: RBIREdge): this {
    this.edges.push(edge);
    return this;
  }

  public build(): RBIRDocument {
    const rawDoc = {
      ir_version: 'rbir/v0.1' as const,
      runbook: {
        id: this.options.runbookId,
        version: this.options.version,
        compiled_at: new Date().toISOString(),
        compiler_version: '0.1.0',
        tenant_id: this.options.tenantId,
      },
      source: {
        uri: this.options.sourceUri,
        source_sha256: this.options.sourceSha256,
      },
      capability_manifest: {
        id: this.options.manifestId,
        version: this.options.manifestVersion,
        capability_manifest_sha256: this.options.manifestSha256,
      },
      entry_node: this.options.entryNode,
      context_schema: this.options.contextSchema ?? { type: 'object' },
      authority_model: this.options.authorityModel ?? [],
      obligations: [],
      policy_constraints: [],
      nodes: this.nodes,
      edges: this.edges,
    };

    return RBIRDocumentSchema.parse(rawDoc);
  }
}
