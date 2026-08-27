export interface GraphMetricResult {
  nodePrecision: number;
  nodeRecall: number;
  nodeF1: number;
  edgePrecision: number;
  edgeRecall: number;
  edgeF1: number;
}

/**
 * Computes structural graph comparison metrics between candidate and golden graphs.
 * Implements Edge F1 and alignment according to spec Q94.
 */
export function calculateGraphMetrics(
  candidateNodes: Set<string>,
  goldenNodes: Set<string>,
  candidateEdges: Set<string>,
  goldenEdges: Set<string>
): GraphMetricResult {
  let matchedNodes = 0;
  for (const n of candidateNodes) {
    if (goldenNodes.has(n)) matchedNodes++;
  }

  const nodePrecision = candidateNodes.size === 0 ? 1 : matchedNodes / candidateNodes.size;
  const nodeRecall = goldenNodes.size === 0 ? 1 : matchedNodes / goldenNodes.size;
  const nodeF1 = nodePrecision + nodeRecall === 0 ? 0 : (2 * nodePrecision * nodeRecall) / (nodePrecision + nodeRecall);

  let matchedEdges = 0;
  for (const e of candidateEdges) {
    if (goldenEdges.has(e)) matchedEdges++;
  }

  const edgePrecision = candidateEdges.size === 0 ? 1 : matchedEdges / candidateEdges.size;
  const edgeRecall = goldenEdges.size === 0 ? 1 : matchedEdges / goldenEdges.size;
  const edgeF1 = edgePrecision + edgeRecall === 0 ? 0 : (2 * edgePrecision * edgeRecall) / (edgePrecision + edgeRecall);

  return {
    nodePrecision,
    nodeRecall,
    nodeF1,
    edgePrecision,
    edgeRecall,
    edgeF1,
  };
}
