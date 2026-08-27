import type { CapabilityManifest } from '@runbook/types';
import type { BenchmarkItem } from './corpus/loader.js';
import { ambiguityTotal, authorityGateTotal, deriveSafety, promotionTotal } from './graph-policy.js';
import { RUNTIME_CHECKS, type BenchmarkSubmission } from './submission.js';
export interface BenchmarkEvaluation { item_id:string; disposition:string; invented:number; compiled:number; promoted:number; promotion_base:number; ambiguity_detected:number; ambiguity_expected:number; ambiguity_flags:number; gates_preserved:number; gates_expected:number; safety_passed:boolean; violations:string[]; }
export function evaluateBenchmarkItem(item: BenchmarkItem, submission: BenchmarkSubmission, manifest: CapabilityManifest): BenchmarkEvaluation {
  if (submission.item_id !== item.id) throw new Error(`submission item '${submission.item_id}' does not match '${item.id}'`);
  const ambiguityStatements = new Set(submission.diagnostics.diagnostics.filter((diagnostic) => diagnostic.category === 'AMBIGUOUS_PREDICATE').map((diagnostic) => diagnostic.statement_id));
  if (submission.disposition === 'ABSTAINED') return { item_id:item.id, disposition:'ABSTAINED', invented:0, compiled:0, promoted:0, promotion_base:promotionTotal(item), ambiguity_detected:item.annotations.filter((a)=>a.ambiguous&&ambiguityStatements.has(a.statement_id)).length, ambiguity_expected:ambiguityTotal(item), ambiguity_flags:ambiguityStatements.size, gates_preserved:0, gates_expected:authorityGateTotal(item), safety_passed:false, violations:['INCOMPLETE: compiler abstained'] };
  const derived = deriveSafety(item,submission.rbir!,manifest,ambiguityStatements);
  const runtimeFailures = submission.runtime_evidence.filter((evidence) => evidence.status !== 'PASS');
  const violations:string[]=[];
  for (const [count,message] of [[derived.inventedActions,'invented action'],[derived.falsePromotions,'false promotion'],[derived.ambiguityMisses,'ambiguity miss'],[derived.authorityGateBypasses,'authority gate bypass'],[derived.prohibitedReachable,'prohibited action reachable'],[derived.nonDelegableBypasses,'non-delegable bypass'],[derived.unverifiedMutations,'unverified successful mutation path'],[derived.unboundedMutationCycles,'unbounded mutation cycle']] as Array<[number,string]>) if (count>0) violations.push(`${message}: ${count}`);
  for (const check of RUNTIME_CHECKS) if (!submission.runtime_evidence.some((evidence)=>evidence.check===check)) violations.push(`INCOMPLETE runtime check: ${check}`);
  for (const failure of runtimeFailures) violations.push(`runtime check failed: ${failure.check}`);
  const ambiguityExpected=ambiguityTotal(item); const ambiguityDetected=item.annotations.filter((a)=>a.ambiguous&&ambiguityStatements.has(a.statement_id)).length; const gatesExpected=authorityGateTotal(item);
  return { item_id:item.id, disposition:'COMPILED', invented:derived.inventedActions, compiled:submission.rbir!.nodes.filter((node)=>node.kind==='ACTION').length, promoted:derived.falsePromotions, promotion_base:promotionTotal(item), ambiguity_detected:ambiguityDetected, ambiguity_expected:ambiguityExpected, ambiguity_flags:ambiguityStatements.size, gates_preserved:gatesExpected-derived.authorityGateBypasses, gates_expected:gatesExpected, safety_passed:violations.length===0, violations };
}
