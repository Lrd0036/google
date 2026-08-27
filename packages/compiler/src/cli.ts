#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { parseMarkdownBlocks } from './parser/markdown.js';
import { compilePlan } from './compile.js';
import { CapabilityManifestSchema } from '@runbook/types';
import { reviewRunbook } from './semantic/review.js';
import { StaticGeminiTransport } from './semantic/extraction.js';

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
      for (const statement of ast.statements) {
        console.log(`  [${statement.node_kind}] ${statement.statement_id}: "${statement.text.slice(0, 40)}..."`);
      }
      console.log('Structural parse completed. Run lintRunbook() after IR construction for static policy checks.');
    } catch (err: unknown) {
      console.error('Compilation failed:', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('review')
  .description('Create a local semantic review artifact without emitting executable RBIR')
  .argument('<runbook>', 'Path to markdown runbook')
  .option('-r, --responses <file>', 'Recorded model response JSON')
  .option('--live', 'Use Gemini 3.5 through the tool-less ADK interpreter agent')
  .option('-o, --output <file>', 'Write review JSON to a file')
  .action(async (runbook: string, options: { responses?: string; live?: boolean; output?: string }) => {
    try {
      const source = readFileSync(runbook, 'utf8');
      const { GoogleGenAiSdkTransport } = await import('./semantic/genai-sdk.js');
      const transport = options.live
        ? new GoogleGenAiSdkTransport()
        : options.responses
          ? new StaticGeminiTransport([JSON.parse(readFileSync(options.responses, 'utf8'))])
          : undefined;
      if (!transport) throw new Error('review requires --live or --responses');
      const artifact = await reviewRunbook(source, runbook, transport);
      const output = JSON.stringify(artifact, null, 2);
      if (options.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.output, `${output}\n`, 'utf8');
      } else console.log(output);
    } catch (err: unknown) {
      console.error('Review failed:', (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('compile')
  .description('Compile a reviewed local plan JSON into RBIR')
  .argument('<runbook>', 'Path to markdown runbook')
  .requiredOption('-p, --plan <file>', 'Path to reviewed compile-plan JSON')
  .requiredOption('-m, --manifest <file>', 'Path to capability manifest JSON')
  .option('-o, --output <file>', 'Write compiled RBIR JSON to a file')
  .action(async (runbook: string, options: { plan: string; manifest: string; output?: string }) => {
    try {
      const source = readFileSync(runbook, 'utf8');
      const plan = JSON.parse(readFileSync(options.plan, 'utf8')) as Parameters<typeof compilePlan>[2];
      const manifest = CapabilityManifestSchema.parse(JSON.parse(readFileSync(options.manifest, 'utf8')));
      const result = compilePlan(source, runbook, plan, manifest);
      if (result.lint.hasErrors) {
        console.error(JSON.stringify(result.lint.artifact, null, 2));
        process.exitCode = 2;
        return;
      }
      const output = JSON.stringify(result.document, null, 2);
      if (options.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.output, `${output}\n`, 'utf8');
      } else console.log(output);
    } catch (err: unknown) {
      console.error('Compilation failed:', (err as Error).message);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
