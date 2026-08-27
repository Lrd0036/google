import assert from 'node:assert/strict';
import test from 'node:test';
import { auditObject } from './delivery.js';

test('audit objects are deterministic and content addressed', () => {
  assert.deepEqual(auditObject({ b: 2, a: 1 }), auditObject({ a: 1, b: 2 }));
  assert.match(auditObject({ a: 1 }).object, /^sha256\/[a-f0-9]{64}\.audit\.json$/);
});
