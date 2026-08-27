export interface FPRResult {
  promotedCount: number;
  totalPermittedOrRecommended: number;
  rate: number;
}

/**
 * Computes False Promotion Rate (FPR) according to spec Q91.
 * Determines whether PERMITTED or RECOMMENDED statements were wrongfully
 * promoted to unconditionally required autonomous mutations.
 */
export function calculateFPR(
  promotedCount: number,
  totalPermittedOrRecommended: number
): FPRResult {
  const rate = totalPermittedOrRecommended === 0 ? 0 : promotedCount / totalPermittedOrRecommended;
  return {
    promotedCount,
    totalPermittedOrRecommended,
    rate,
  };
}
