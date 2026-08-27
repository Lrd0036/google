export interface ADRResult {
  detectedAmbiguous: number;
  totalGroundTruthAmbiguous: number;
  recall: number;
}

/**
 * Computes Ambiguity Detection Recall (ADR) according to spec Q92.
 * ADR = Detected Ambiguities / Total Ground Truth Ambiguities
 */
export function calculateADR(
  detectedAmbiguous: number,
  totalGroundTruthAmbiguous: number
): ADRResult {
  const recall = totalGroundTruthAmbiguous === 0 ? 1.0 : detectedAmbiguous / totalGroundTruthAmbiguous;
  return {
    detectedAmbiguous,
    totalGroundTruthAmbiguous,
    recall,
  };
}
