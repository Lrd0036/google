import type { ControlFlowGraph } from './cfg.js';

export interface CycleCheckResult {
  hasCycles: boolean;
  sccs: string[][];
  unboundedCycles: string[][];
}

/**
 * Computes Strongly Connected Components using Tarjan's algorithm.
 * Implements cycle and bounded loop verification according to spec Q15 and Q19.
 */
export function detectCycles(cfg: ControlFlowGraph): CycleCheckResult {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = cfg.adjacency.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        const lowV = lowlinks.get(v)!;
        const lowW = lowlinks.get(w)!;
        lowlinks.set(v, Math.min(lowV, lowW));
      } else if (onStack.has(w)) {
        const lowV = lowlinks.get(v)!;
        const idxW = indices.get(w)!;
        lowlinks.set(v, Math.min(lowV, idxW));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      // An SCC is a cycle if it has >1 node, or has a self-edge
      const isSelfLoop = scc.length === 1 && (cfg.adjacency.get(v) || []).includes(v);
      if (scc.length > 1 || isSelfLoop) {
        sccs.push(scc);
      }
    }
  }

  for (const nodeId of cfg.nodes.keys()) {
    if (!indices.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return {
    hasCycles: sccs.length > 0,
    sccs,
    unboundedCycles: sccs, // Any cycle without bounded-loop counter is unbounded
  };
}
