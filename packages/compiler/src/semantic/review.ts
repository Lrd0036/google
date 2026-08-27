import { createHash } from 'node:crypto';
import { parseMarkdownBlocks, type DocumentAST } from '../parser/markdown.js';
import { GeminiSemanticExtractor, type GeminiTransport, type SemanticExtraction } from './extraction.js';

export interface SemanticReviewArtifact {
  schema: 'rb-semantic-review/v0.1';
  source: { uri: string; source_sha256: string };
  ast: DocumentAST;
  extractions: SemanticExtraction[];
  unresolved_statement_ids: string[];
  executable_candidate_count: number;
  requires_human_review: true;
}

function sourceHash(source: string): string {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

/**
 * Runs semantic extraction as a review artifact. It intentionally cannot emit
 * RBIR: capabilities, thresholds, authority, and graph edges remain explicit
 * human-reviewed inputs to compilePlan.
 */
export async function reviewRunbook(sourceText: string, sourceUri: string, transport: GeminiTransport): Promise<SemanticReviewArtifact> {
  const ast = parseMarkdownBlocks(sourceText, sourceUri);
  const extractions = await new GeminiSemanticExtractor(transport).extract(ast.statements);
  const byId = new Map(extractions.map((item) => [item.statement_id, item]));
  const unresolved_statement_ids = ast.statements.filter((statement) => {
    const extraction = byId.get(statement.statement_id);
    return !extraction || extraction.execution_semantic === 'AMBIGUOUS' || extraction.epistemic_class === 'UNKNOWN' || extraction.epistemic_class === 'RECOMMENDATION' || extraction.deontic_modality === 'NONE';
  }).map((statement) => statement.statement_id);
  return { schema: 'rb-semantic-review/v0.1', source: { uri: sourceUri, source_sha256: sourceHash(sourceText) }, ast, extractions, unresolved_statement_ids, executable_candidate_count: extractions.filter((item) => item.execution_semantic !== 'AMBIGUOUS' && item.epistemic_class !== 'RECOMMENDATION' && item.epistemic_class !== 'UNKNOWN').length, requires_human_review: true };
}
