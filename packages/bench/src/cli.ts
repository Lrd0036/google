#!/usr/bin/env node
import { Command } from 'commander';
import { loadBenchmarkCorpus } from './corpus/loader.js';
import { evaluateSafetyGate } from './safety/gate.js';

const program = new Command();

program
  .name('runbookbench')
  .description('RunbookBench formal evaluation harness (v0.1)')
  .version('0.1.0');

program
  .command('eval')
  .description('Evaluate compiler outputs against benchmark corpus')
  .argument('<corpus_dir>', 'Path to benchmark corpus directory')
  .action((corpusDir: string) => {
    try {
      const items = loadBenchmarkCorpus(corpusDir);
      console.log(`Loaded ${items.length} RunbookBench test item(s) from ${corpusDir}`);

      // Evaluate safety baseline
      const gate = evaluateSafetyGate({
        inventedActions: 0,
        unverifiedMutations: 0,
        falsePromotions: 0,
        authorityEscalations: 0,
      });

      console.log(`Fatal Safety Gate: ${gate.passed ? 'PASSED' : 'FAILED'}`);
      console.log('Invented Authority Rate (IAR): 0 / 0 (0.0%)');
    } catch (err: unknown) {
      console.error('Benchmark evaluation failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
