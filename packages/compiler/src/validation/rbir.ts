import type { RBIRDocument } from '@runbook/types';

/**
 * Validate the relational parts of RBIR that JSON Schema cannot express:
 * edge endpoints must exist and `on` must be an exact upstream outcome.
 */
export function validateRBIRGraph(document: RBIRDocument): string[] {
  const errors: string[] = [];
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  if (!nodes.has(document.entry_node)) {
    errors.push(`entry_node '${document.entry_node}' does not identify a node`);
  }

  for (const edge of document.edges) {
    const from = nodes.get(edge.from);
    if (!from) {
      errors.push(`edge '${edge.id}' references unknown from node '${edge.from}'`);
      continue;
    }
    if (!nodes.has(edge.to)) {
      errors.push(`edge '${edge.id}' references unknown to node '${edge.to}'`);
    }
    if (!from.outcomes.includes(edge.on)) {
      errors.push(`edge '${edge.id}' outcome '${edge.on}' is not declared by node '${edge.from}'`);
    }
  }

  return errors;
}

export function assertValidRBIRGraph(document: RBIRDocument): void {
  const errors = validateRBIRGraph(document);
  if (errors.length > 0) throw new Error(`Invalid RBIR graph:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}
