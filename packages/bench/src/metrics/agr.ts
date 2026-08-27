export interface AGRResult {
  preserved: number;
  total: number;
  recall: number;
}

/** Authority Gate Recall: preserved path-dominating gates / gold gates. */
export function calculateAGR(preserved: number, total: number): AGRResult {
  return { preserved, total, recall: total === 0 ? 1 : preserved / total };
}
