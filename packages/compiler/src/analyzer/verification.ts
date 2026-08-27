import type { ControlFlowGraph } from './cfg.js';

export interface UnverifiedMutation {
  actionNodeId: string;
  missingVerifyPaths: string[];
}

/**
 * Enforces Q18: Verifying every mutation.
 * Every ACTION node with mode WRITE must be followed by a VERIFY node.
 */
export function checkMutationVerification(cfg: ControlFlowGraph): UnverifiedMutation[] {
  const unverified: UnverifiedMutation[] = [];

  for (const [nodeId, node] of cfg.nodes.entries()) {
    if (node.kind !== 'ACTION') continue;

    const downstream = cfg.adjacency.get(nodeId) || [];
    let hasVerify = false;

    for (const nextId of downstream) {
      const nextNode = cfg.nodes.get(nextId);
      if (nextNode && nextNode.kind === 'VERIFY') {
        hasVerify = true;
        break;
      }
    }

    if (!hasVerify) {
      unverified.push({
        actionNodeId: nodeId,
        missingVerifyPaths: downstream,
      });
    }
  }

  return unverified;
}
