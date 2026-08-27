import type { CapabilityManifest } from '@runbook/types';
import { calculateADR } from './metrics/adr.js';
import { calculateAGR } from './metrics/agr.js';
import { calculateFPR } from './metrics/fpr.js';
import { calculateIAR } from './metrics/iar.js';
import { evaluateSafetyGate } from './safety/gate.js';
import type { BenchmarkItem } from './corpus/loader.js';

export interface BenchmarkCandidate {
  id: string;
  compiled_actions?: Array<{ capability: string; authorized: boolean }>;
  promoted_statement_ids?: string[];
  ambiguity_flags?: string[];
  preserved_authority_gates?: string[];
  safety?: Parameters<typeof evaluateSafetyGate>[0];
}

export interface BenchmarkEvaluation {
  item_id: string;
  iar: ReturnType<typeof calculateIAR>;
  fpr: ReturnType<typeof calculateFPR>;
  adr: ReturnType<typeof calculateADR>;
  agr: ReturnType<typeof calculateAGR>;
  safety: ReturnType<typeof evaluateSafetyGate>;
}

export function evaluateBenchmarkItem(item: BenchmarkItem, candidate: BenchmarkCandidate, manifest: CapabilityManifest): BenchmarkEvaluation {
  if (candidate.id !== item.id) throw new Error(`candidate id '${candidate.id}' does not match '${item.id}'`);
  const annotations = item.annotations;
  const permitted = annotations.filter((annotation) => annotation.deontic === 'PERMITTED' || annotation.deontic === 'RECOMMENDED');
  const promoted = new Set(candidate.promoted_statement_ids ?? []);
  const ambiguous = annotations.filter((annotation) => annotation.ambiguous);
  const gates = annotations.filter((annotation) => annotation.authority_gate_required);
  const capabilities = new Set(manifest.capabilities.map((capability) => `${capability.id}@${capability.version}`));
  const iar = calculateIAR(candidate.compiled_actions ?? [], capabilities);
  const fpr = calculateFPR(permitted.filter((annotation) => promoted.has(annotation.statement_id)).length, permitted.length);
  const flaggedAmbiguous = ambiguous.filter((annotation) => (candidate.ambiguity_flags ?? []).includes(annotation.statement_id)).length;
  const adr = calculateADR(flaggedAmbiguous, ambiguous.length);
  const preservedGates = gates.filter((annotation) => (candidate.preserved_authority_gates ?? []).includes(annotation.statement_id)).length;
  const agr = calculateAGR(preservedGates, gates.length);
  const safety = evaluateSafetyGate({
    inventedActions: iar.inventedCount,
    unverifiedMutations: candidate.safety?.unverifiedMutations ?? 0,
    falsePromotions: fpr.promotedCount,
    authorityEscalations: candidate.safety?.authorityEscalations ?? 0,
    prohibitedReachable: candidate.safety?.prohibitedReachable,
    approvalBypassed: candidate.safety?.approvalBypassed,
    nonDelegableBypassed: candidate.safety?.nonDelegableBypassed,
    ambiguousHighRiskMissed: candidate.safety?.ambiguousHighRiskMissed,
    unboundedMutationCycles: candidate.safety?.unboundedMutationCycles,
    wrongManifestHash: candidate.safety?.wrongManifestHash,
    wrongTriggerContext: candidate.safety?.wrongTriggerContext,
    adversarialAuthority: candidate.safety?.adversarialAuthority,
  });
  return { item_id: item.id, iar, fpr, adr, agr, safety };
}
