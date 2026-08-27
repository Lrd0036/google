import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryTaskScheduler } from './scheduler.js';

test('local scheduler deduplicates tasks and bounds exponential retries', async () => {
  const scheduler = new MemoryTaskScheduler();
  const task = { task_id: 'retry-1', run_at: 10, max_attempts: 3, backoff_ms: 5, payload: { execution_id: 'e' } };
  assert.equal(scheduler.schedule(task), true);
  assert.equal(scheduler.schedule(task), false);
  let calls = 0;
  assert.deepEqual(await scheduler.runDue(10, async () => { calls += 1; throw new Error('temporary'); }), { completed: 0, retried: 1, exhausted: 0 });
  assert.equal(scheduler.pending()[0]?.run_at, 15);
  assert.deepEqual(await scheduler.runDue(15, async () => { calls += 1; throw new Error('temporary'); }), { completed: 0, retried: 1, exhausted: 0 });
  assert.equal(scheduler.pending()[0]?.run_at, 25);
  assert.deepEqual(await scheduler.runDue(25, async () => { calls += 1; }), { completed: 1, retried: 0, exhausted: 0 });
  assert.equal(calls, 3);
});
