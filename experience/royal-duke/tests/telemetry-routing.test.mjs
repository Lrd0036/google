import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/lib/useRangeTelemetry.ts', import.meta.url), 'utf8');

test('browser telemetry uses the fixed same-origin Royal Duke API', () => {
  assert.match(source, /const endpoint = '\/api\/royal-duke'/);
  assert.doesNotMatch(source, /URLSearchParams|\?range=|new URL\(value\)/);
  assert.match(source, /new EventSource\(`\$\{endpoint\}\/events`\)/);
  assert.match(source, /post\(`\/actions\/\$\{encodeURIComponent\(id\)\}`\)/);
});
