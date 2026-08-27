import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewRunbook } from './review.js';
import { StaticGeminiTransport } from './extraction.js';
import { parseMarkdownBlocks } from '../parser/markdown.js';

test('semantic review preserves ambiguity and never emits executable authority', async () => {
  const source = '# Recovery\n\nRetry the job when the upstream is transient.\n\nUse a reasonable threshold.';
  const statements = parseMarkdownBlocks(source, 'fixture.md').statements;
  const response = { candidates: [{ content: { parts: [{ text: JSON.stringify(statements.map((statement, index) => ({ statement_id: statement.statement_id, epistemic_class: 'POLICY', deontic_modality: 'REQUIRED', execution_semantic: index === 0 ? 'ACTION' : 'AMBIGUOUS', roles: [], conditions: [], action_intent: index === 0 ? 'retry job' : null, explicit_approvals: [], prohibitions: [], verification_obligations: [], timers_or_retries: [], ambiguity_flags: index === 0 ? [] : ['threshold undefined'] }))) }] } }] };
  const review = await reviewRunbook(source, 'fixture.md', new StaticGeminiTransport([response]));
  assert.equal(review.requires_human_review, true);
  assert.equal(review.executable_candidate_count, 1);
  assert.equal(review.unresolved_statement_ids.length, 1);
  assert.equal('nodes' in review, false);
});
