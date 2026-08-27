import type { CapabilityManifest, DiagnosticArtifact, DiagnosticItem, RBIRDocument, SourceSpan } from '@runbook/types';
import { buildControlFlowGraph } from './cfg.js';
import { detectCycles } from './cycles.js';
import { DiagnosticCollector } from '../diagnostics/emitter.js';
import { analyzeReachability } from './reachability.js';

export interface LinterOptions { manifest?: CapabilityManifest; statementSources?: Map<string, SourceSpan>; defaultSource?: SourceSpan; }
export interface LintResult { artifact: DiagnosticArtifact; hasErrors: boolean; }
const fallbackSource: SourceSpan = { uri: 'runbook.md', start: { line: 1, column: 1, byte: 0 }, end: { line: 1, column: 1, byte: 0 } };
const ambiguous = /\b(high|low|bad|reasonable|excessive|alarming|significant|suspicious|appropriate|as necessary|as needed|when possible|soon|quickly)\b/i;

function statementId(node: RBIRDocument['nodes'][number]): string { return node.statement_ids[0] ?? `stmt_node_${node.id}`; }
function capabilityId(value: string): string { return value.includes('@') ? value : `${value}@1`; }
function makeDiagnostic(code: string, category: DiagnosticItem['category'], message: string, node: RBIRDocument['nodes'][number], options: LinterOptions): DiagnosticItem {
  return { code, severity: 'ERROR', category, message, statement_id: statementId(node), related_node: node.id, source: options.statementSources?.get(statementId(node)) ?? options.defaultSource ?? fallbackSource, required_resolution: ['Resolve the issue and recompile the runbook.'] };
}

function everyCompletingPathVerified(document: RBIRDocument, actionId: string): boolean {
  const graph = buildControlFlowGraph(document.nodes, document.edges); const seen = new Set<string>();
  function walk(nodeId: string, verified: boolean): boolean {
    const key = `${nodeId}:${verified}`; if (seen.has(key)) return true; seen.add(key);
    const node = graph.nodes.get(nodeId); if (!node) return false;
    const nextVerified = verified || (node.kind === 'VERIFY' && node.verify?.target_action_node === actionId);
    if (node.kind === 'TERMINAL') return nextVerified || node.terminal?.status !== 'RESOLVED';
    const next = graph.adjacency.get(nodeId) ?? []; return next.length > 0 && next.every((child) => walk(child, nextVerified));
  }
  return (graph.adjacency.get(actionId) ?? []).length > 0 && (graph.adjacency.get(actionId) ?? []).every((child) => walk(child, false));
}

function denyMatches(constraint: Record<string, unknown>, node: RBIRDocument['nodes'][number]): boolean {
  if (constraint.effect !== 'DENY' || node.kind !== 'ACTION') return false;
  const terms = [constraint.capability, constraint.semantic_action, constraint.action].filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase());
  return terms.some((term) => term === node.action?.capability.toLowerCase() || node.description.toLowerCase().includes(term));
}

function schemaAtPointer(schema: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  if (!ref.startsWith('/context')) return undefined;
  let current = schema;
  for (const segment of ref.split('/').slice(2)) {
    const properties = current.properties;
    if (!properties || typeof properties !== 'object') return undefined;
    const next = (properties as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (!next || typeof next !== 'object') return undefined;
    current = next as Record<string, unknown>;
  }
  return current;
}

function bindingTypeError(value: unknown, expected: Record<string, unknown>, contextSchema: Record<string, unknown>): string | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).ref;
    if (typeof ref !== 'string') return undefined;
    const actual = schemaAtPointer(contextSchema, ref);
    if (!actual) return `Reference '${ref}' is not defined by context_schema.`;
    if (actual.type && expected.type && actual.type !== expected.type) return `Reference type '${actual.type}' is not assignable to capability type '${expected.type}'.`;
  }
  return undefined;
}

/** Run fail-closed static checks over a candidate RBIR document. */
export function lintRunbook(document: RBIRDocument, options: LinterOptions = {}): LintResult {
  const collector = new DiagnosticCollector(); const graph = buildControlFlowGraph(document.nodes, document.edges); const cycles = detectCycles(graph);
  const reachability = analyzeReachability(document);
  for (const nodeId of reachability.unreachable) {
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (node) collector.add(makeDiagnostic('RBK-601', 'DEAD_END_OR_UNREACHABLE', `Node '${nodeId}' is unreachable from entry_node.`, node, options));
  }
  for (const nodeId of reachability.deadEnds) {
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (node) collector.add(makeDiagnostic('RBK-602', 'DEAD_END_OR_UNREACHABLE', `Node '${nodeId}' cannot reach a RESOLVED terminal.`, node, options));
  }
  for (const node of document.nodes) {
    if (node.kind === 'DETERMINISTIC' && ambiguous.test(node.description)) collector.add(makeDiagnostic('RBK-104', 'AMBIGUOUS_PREDICATE', `Predicate '${node.description}' is not executable without a typed threshold or approved rubric.`, node, options));
    if (node.kind === 'ACTION') {
      if (options.manifest && !options.manifest.capabilities.some((capability) => `${capability.id}@${capability.version}` === capabilityId(node.action?.capability ?? ''))) collector.add(makeDiagnostic('RBK-301', 'UNKNOWN_CAPABILITY', `Capability '${node.action?.capability ?? ''}' is not present in the capability manifest.`, node, options));
      const capability = options.manifest?.capabilities.find((item) => `${item.id}@${item.version}` === capabilityId(node.action?.capability ?? ''));
      if (capability && node.action) {
        for (const [name, binding] of Object.entries(node.action.parameters)) {
          const expected = (capability.input_schema.properties as Record<string, unknown> | undefined)?.[name];
          if (expected && typeof expected === 'object') {
            const error = bindingTypeError(binding, expected as Record<string, unknown>, document.context_schema);
            if (error) collector.add(makeDiagnostic('RBK-302', 'TYPE_MISMATCH', `${name}: ${error}`, node, options));
          }
        }
      }
      if (capability?.mode === 'WRITE' && !everyCompletingPathVerified(document, node.id)) collector.add(makeDiagnostic('RBK-403', 'UNVERIFIED_MUTATION', `Write action '${node.id}' does not reach verification on every completing path.`, node, options));
      if (document.policy_constraints.some((constraint) => denyMatches(constraint, node))) collector.add(makeDiagnostic('RBK-502', 'FORBIDDEN_MUTATION', `Action '${node.action?.capability ?? node.description}' violates a compiled prohibition.`, node, options));
    }
    if (node.kind === 'VERIFY' && options.manifest) {
      const capabilityName = capabilityId(node.verify?.capability ?? '');
      const capability = options.manifest.capabilities.find((item) => `${item.id}@${item.version}` === capabilityName);
      if (!capability || capability.mode !== 'READ' || capability.risk !== 'R0_OBSERVE') {
        collector.add(makeDiagnostic('RBK-404', 'UNSAFE_VERIFICATION', `Verification capability '${node.verify?.capability ?? ''}' must be declared READ with risk R0_OBSERVE.`, node, options));
      }
    }
  }
  const policyTerms = new Map<string, Set<string>>();
  for (const constraint of document.policy_constraints) {
    const term = [constraint.capability, constraint.semantic_action, constraint.action].find((value): value is string => typeof value === 'string');
    const effect = typeof constraint.effect === 'string' ? constraint.effect : undefined;
    if (!term || !effect) continue;
    const effects = policyTerms.get(term.toLowerCase()) ?? new Set<string>();
    effects.add(effect.toUpperCase()); policyTerms.set(term.toLowerCase(), effects);
  }
  for (const [term, effects] of policyTerms) if (effects.has('ALLOW') && effects.has('DENY')) {
    const node = document.nodes[0];
    if (node) collector.add(makeDiagnostic('RBK-105', 'CONTRADICTORY_POLICY', `Policy constraints both allow and deny '${term}' without an explicit precedence rule.`, node, options));
  }
  for (const cycle of cycles.unboundedCycles) { const node = document.nodes.find((candidate) => cycle.includes(candidate.id)); if (node) collector.add(makeDiagnostic('RBK-201', 'UNBOUNDED_RETRY', `Cycle [${cycle.join(', ')}] lacks finite retry, exit, and backoff bounds.`, node, options)); }
  return { artifact: collector.toArtifact(), hasErrors: collector.hasErrors() };
}
