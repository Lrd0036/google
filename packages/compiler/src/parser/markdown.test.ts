import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownBlocks } from './markdown.js';

test('parser preserves source locations across Unicode and mixed blocks', () => {
  const source = '# Runbook\r\n\r\n> Evidence: café\r\n\r\n1. **MUST** isolate host\r\n2. MAY retry\r\n\r\n```sh\r\necho safe\r\n```';
  const ast = parseMarkdownBlocks(source, 'fixture.md');
  assert.equal(ast.nodes.some((node) => node.kind === 'Heading'), true);
  assert.equal(ast.nodes.some((node) => node.kind === 'BlockQuote'), true);
  assert.equal(ast.nodes.some((node) => node.kind === 'OrderedList'), true);
  assert.equal(ast.nodes.some((node) => node.kind === 'CodeFence'), true);
  assert.equal(ast.sourceText, source);
  assert.ok(ast.statements.every((statement) => statement.source.start.byte >= 0));
});

test('semantic statement IDs are formatting and whitespace invariant but modality sensitive', () => {
  const formatted = parseMarkdownBlocks('## Actions\n\n**MUST** isolate the host.', 'fixture.md').statements[0];
  const plain = parseMarkdownBlocks('## Actions\n\nMUST isolate   the host.', 'fixture.md').statements[0];
  const may = parseMarkdownBlocks('## Actions\n\nMAY isolate the host.', 'fixture.md').statements[0];
  assert.ok(formatted && plain && may);
  assert.equal(formatted.statement_id, plain.statement_id);
  assert.notEqual(formatted.statement_id, may.statement_id);
});
