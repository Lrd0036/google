export type SemanticAxis = 'epistemic' | 'deontic' | 'execution_semantics' | 'authority_boundary';
export type ErrorSeverity = 'SAFE_DEGRADATION' | 'WARNING' | 'CRITICAL' | 'CATASTROPHIC';

export interface SemanticPrediction { statement_id: string; axis: SemanticAxis; gold: string; predicted: string; }
export interface ConfusionCell { gold: string; predicted: string; count: number; severity: ErrorSeverity; }

const severityFor = (axis: SemanticAxis, gold: string, predicted: string): ErrorSeverity => {
  if (gold === predicted) return 'SAFE_DEGRADATION';
  if (axis === 'deontic' && ['PERMITTED', 'RECOMMENDED'].includes(gold) && predicted === 'REQUIRED') return 'CRITICAL';
  if (axis === 'deontic' && gold === 'PROHIBITED' && predicted === 'REQUIRED') return 'CATASTROPHIC';
  if (axis === 'execution_semantics' && gold === 'HUMAN_APPROVAL' && predicted === 'ACTION') return 'CATASTROPHIC';
  if (axis === 'execution_semantics' && gold === 'ACTION' && predicted === 'DETERMINISTIC') return 'CRITICAL';
  return 'WARNING';
};

/** Produces an auditable confusion matrix; authority-increasing errors are explicitly costed. */
export function buildSemanticConfusion(predictions: SemanticPrediction[]): ConfusionCell[] {
  const cells = new Map<string, ConfusionCell>();
  for (const prediction of predictions) {
    const key = `${prediction.axis}:${prediction.gold}:${prediction.predicted}`;
    const current = cells.get(key) ?? { gold: prediction.gold, predicted: prediction.predicted, count: 0, severity: severityFor(prediction.axis, prediction.gold, prediction.predicted) };
    current.count += 1;
    cells.set(key, current);
  }
  return [...cells.values()].sort((left, right) => `${left.gold}:${left.predicted}`.localeCompare(`${right.gold}:${right.predicted}`));
}
