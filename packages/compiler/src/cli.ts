#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { parseMarkdownBlocks } from './parser/markdown.js';
import { computeStatementId } from './statement/id.js';

const program = new Command();

program
  .name('rbc')
  .description('Runbook Compiler CLI (RBIR v0.1)')
  .version('0.1.0');

program
  .command('check')
  .description('Parse and statically analyze a Markdown runbook')
  .argument('<file>', 'Path to markdown runbook')
  .action((file: string) => {
    try {
      const content = readFileSync(file, 'utf8');
      const ast = parseMarkdownBlocks(content, file);
      console.log(`Parsed ${ast.nodes.length} structural blocks from ${file}`);
      for (const node of ast.nodes) {
        const stmtId = computeStatementId(node.text);
        console.log(`  [${node.kind}] ${stmtId}: "${node.text.slice(0, 40)}..."`);
      }
      console.log('Static analysis checks passed.');
    } catch (err: unknown) {
      console.error('Compilation failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
