import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSemanticConfusion } from './semantic.js';

test('semantic confusion matrix assigns authority-increasing errors higher cost', () => {
  const cells = buildSemanticConfusion([
    { statement_id: 'a', axis: 'deontic', gold: 'RECOMMENDED', predicted: 'REQUIRED' },
    { statement_id: 'b', axis: 'deontic', gold: 'PROHIBITED', predicted: 'REQUIRED' },
    { statement_id: 'c', axis: 'execution_semantics', gold: 'HUMAN_APPROVAL', predicted: 'ACTION' },
  ]);
  assert.deepEqual(cells.map((cell) => cell.severity).sort(), ['CATASTROPHIC', 'CATASTROPHIC', 'CRITICAL']);
});
