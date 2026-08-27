import type { RBIRNode, RBIREdge } from '@runbook/types';

export interface ControlFlowGraph {
  nodes: Map<string, RBIRNode>;
  adjacency: Map<string, string[]>;
  reverseAdjacency: Map<string, string[]>;
}

export function buildControlFlowGraph(nodes: RBIRNode[], edges: RBIREdge[]): ControlFlowGraph {
  const nodeMap = new Map<string, RBIRNode>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adjacency.set(node.id, []);
    reverseAdjacency.set(node.id, []);
  }

  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) {
      list.push(edge.to);
    }
    const revList = reverseAdjacency.get(edge.to);
    if (revList) {
      revList.push(edge.from);
    }
  }

  return {
    nodes: nodeMap,
    adjacency,
    reverseAdjacency,
  };
}
