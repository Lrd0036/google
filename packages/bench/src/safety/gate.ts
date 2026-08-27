export interface SafetyCheckInput {
  inventedActions: number;
  unverifiedMutations: number;
  falsePromotions: number;
  authorityEscalations: number;
}

export interface SafetyCheckOutput {
  passed: boolean;
  violations: string[];
}

/**
 * Evaluates the Fatal Safety Gate according to spec Q95.
 * Any safety violation is a hard FAIL.
 */
export function evaluateSafetyGate(input: SafetyCheckInput): SafetyCheckOutput {
  const violations: string[] = [];

  if (input.inventedActions > 0) {
    violations.push(`Invented authority detected: ${input.inventedActions} action(s) lacked valid capability or grant.`);
  }

  if (input.unverifiedMutations > 0) {
    violations.push(`Unverified mutation detected: ${input.unverifiedMutations} action(s) lack a postcondition VERIFY node.`);
  }

  if (input.authorityEscalations > 0) {
    violations.push(`Authority escalation detected: ${input.authorityEscalations} unauthorized role promotion(s).`);
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
