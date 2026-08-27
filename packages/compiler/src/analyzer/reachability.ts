import type { RBIRDocument } from '@runbook/types';
import { buildControlFlowGraph } from './cfg.js';

export interface ReachabilityResult { reachable: Set<string>; canReachTerminal: Set<string>; unreachable: string[]; deadEnds: string[]; }

function walk(adjacency: Map<string, string[]>, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const node = queue.shift()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

export function analyzeReachability(document: RBIRDocument): ReachabilityResult {
  const graph = buildControlFlowGraph(document.nodes, document.edges);
  const reachable = walk(graph.adjacency, [document.entry_node]);
  const terminals = document.nodes.filter((node) => node.kind === 'TERMINAL').map((node) => node.id);
  const canReachTerminal = walk(graph.reverseAdjacency, terminals);
  const unreachable = document.nodes.map((node) => node.id).filter((id) => !reachable.has(id));
  const deadEnds = document.nodes.filter((node) => reachable.has(node.id) && node.kind !== 'TERMINAL' && !canReachTerminal.has(node.id)).map((node) => node.id);
  return { reachable, canReachTerminal, unreachable, deadEnds };
}
