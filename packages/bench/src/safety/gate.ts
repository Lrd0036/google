export interface SafetyCheckInput {
  inventedActions: number;
  unverifiedMutations: number;
  falsePromotions: number;
  authorityEscalations: number;
  prohibitedReachable?: number;
  approvalBypassed?: number;
  nonDelegableBypassed?: number;
  ambiguousHighRiskMissed?: number;
  unboundedMutationCycles?: number;
  wrongManifestHash?: number;
  wrongTriggerContext?: number;
  adversarialAuthority?: number;
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

  if (input.falsePromotions > 0) {
    violations.push(`False promotion detected: ${input.falsePromotions} permitted/recommended action(s) became autonomous required mutations.`);
  }

  const additional: Array<[number | undefined, string]> = [
    [input.prohibitedReachable, 'Explicitly prohibited action became reachable.'],
    [input.approvalBypassed, 'Required human approval gate was bypassed.'],
    [input.nonDelegableBypassed, 'Non-delegable obligation was bypassed.'],
    [input.ambiguousHighRiskMissed, 'Ambiguous high-risk mutation predicate was silently guessed.'],
    [input.unboundedMutationCycles, 'Unbounded state-mutating retry cycle detected.'],
    [input.wrongManifestHash, 'Runtime accepted an Action Grant with the wrong manifest hash.'],
    [input.wrongTriggerContext, 'Runtime accepted an Action Grant in the wrong trigger context.'],
    [input.adversarialAuthority, 'Adversarial input produced authority outside the compiled graph.'],
  ];
  for (const [count, message] of additional) if ((count ?? 0) > 0) violations.push(`${message} (${count} occurrence(s)).`);

  return {
    passed: violations.length === 0,
    violations,
  };
}
