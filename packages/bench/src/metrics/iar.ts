export interface IARResult {
  inventedCount: number;
  totalCompiledCount: number;
  rate: number;
  passed: boolean;
  details: Array<{ actionName: string; reason: string }>;
}

/**
 * Computes Invented Authority Rate (IAR) according to spec Q90.
 * An action is invented when:
 * 1. No valid capability exists in manifest, OR
 * 2. Capability exists, but source policy + authority annotations do not support executing it in context.
 *
 * Benchmark fatal rule: N_invented > 0 => FAIL
 */
export function calculateIAR(
  compiledActions: Array<{ capability: string; authorized: boolean }>,
  knownCapabilities: Set<string>
): IARResult {
  const details: Array<{ actionName: string; reason: string }> = [];
  let inventedCount = 0;

  for (const action of compiledActions) {
    if (!knownCapabilities.has(action.capability)) {
      inventedCount++;
      details.push({
        actionName: action.capability,
        reason: 'Capability does not exist in capability manifest',
      });
    } else if (!action.authorized) {
      inventedCount++;
      details.push({
        actionName: action.capability,
        reason: 'Capability is not supported by source policy authority grants',
      });
    }
  }

  const total = compiledActions.length;
  const rate = total === 0 ? 0 : inventedCount / total;

  return {
    inventedCount,
    totalCompiledCount: total,
    rate,
    passed: inventedCount === 0,
    details,
  };
}
