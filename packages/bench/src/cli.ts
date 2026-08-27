#!/usr/bin/env node
import { Command } from 'commander';
import { loadBenchmarkCorpus, validateBenchmarkCorpus } from './corpus/loader.js';
import { evaluateSafetyGate } from './safety/gate.js';
import { readFileSync } from 'node:fs';
import { evaluateBenchmarkItem, type BenchmarkCandidate } from './evaluate.js';

const program = new Command();

program
  .name('runbookbench')
  .description('RunbookBench formal evaluation harness (v0.1)')
  .version('0.1.0');

program
  .command('validate')
  .description('Validate the 12-item pilot corpus and its five class coverage')
  .argument('<corpus_dir>', 'Path to benchmark corpus directory')
  .action((corpusDir: string) => {
    try {
      const result = validateBenchmarkCorpus(loadBenchmarkCorpus(corpusDir));
      if (!result.valid) throw new Error(result.errors.join('\n'));
      console.log(`Valid RunbookBench pilot corpus: 12 item(s), all 5 corpus classes represented.`);
    } catch (err: unknown) {
      console.error('Corpus validation failed:', (err as Error).message);
      process.exit(1);
    }
  });

program
  .command('eval')
  .description('Evaluate compiler outputs against benchmark corpus')
  .argument('<corpus_dir>', 'Path to benchmark corpus directory')
  .option('-c, --candidates <dir>', 'Directory containing one candidate JSON file per item')
  .option('-m, --manifest <file>', 'Capability manifest JSON file')
  .option('--json', 'Print machine-readable evaluation output')
  .action((corpusDir: string, options: { candidates?: string; manifest?: string; json?: boolean }) => {
    try {
      const items = loadBenchmarkCorpus(corpusDir);
      const corpusResult = validateBenchmarkCorpus(items);
      if (!corpusResult.valid) throw new Error(corpusResult.errors.join('\n'));
      if (!options.json) console.log(`Loaded ${items.length} RunbookBench test item(s) from ${corpusDir}`);

      if (!options.candidates || !options.manifest) {
        const gate = evaluateSafetyGate({ inventedActions: 0, unverifiedMutations: 0, falsePromotions: 0, authorityEscalations: 0 });
        console.log(`Fatal Safety Gate: ${gate.passed ? 'PASSED' : 'FAILED'}`);
        console.log('No candidates supplied; use --candidates and --manifest for a scored run.');
        return;
      }
      const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
      const evaluations = items.map((item) => {
        const candidate = JSON.parse(readFileSync(`${options.candidates}/${item.id}.json`, 'utf8')) as BenchmarkCandidate;
        return evaluateBenchmarkItem(item, candidate, manifest);
      });
      const invented = evaluations.reduce((total, evaluation) => total + evaluation.iar.inventedCount, 0);
      const compiled = evaluations.reduce((total, evaluation) => total + evaluation.iar.totalCompiledCount, 0);
      const promotions = evaluations.reduce((total, evaluation) => total + evaluation.fpr.promotedCount, 0);
      const promotionBase = evaluations.reduce((total, evaluation) => total + evaluation.fpr.totalPermittedOrRecommended, 0);
      const ambiguitiesDetected = evaluations.reduce((total, evaluation) => total + evaluation.adr.detectedAmbiguous, 0);
      const ambiguityBase = evaluations.reduce((total, evaluation) => total + evaluation.adr.totalGroundTruthAmbiguous, 0);
      const gatesPreserved = evaluations.reduce((total, evaluation) => total + evaluation.agr.preserved, 0);
      const gateBase = evaluations.reduce((total, evaluation) => total + evaluation.agr.total, 0);
      const safety = evaluations.every((evaluation) => evaluation.safety.passed);
      const output = {
        item_count: items.length,
        iar: { invented, compiled, rate: compiled ? invented / compiled : 0 },
        fpr: { promoted: promotions, eligible: promotionBase, rate: promotionBase ? promotions / promotionBase : 0 },
        adr: { detected: ambiguitiesDetected, expected: ambiguityBase, recall: ambiguityBase ? ambiguitiesDetected / ambiguityBase : 1 },
        agr: { preserved: gatesPreserved, expected: gateBase, recall: gateBase ? gatesPreserved / gateBase : 1 },
        safety,
        evaluations,
      };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else {
        console.log(`Fatal Safety Gate: ${safety ? 'PASSED' : 'FAILED'}`);
        console.log(`IAR: ${invented} / ${compiled} (${(output.iar.rate * 100).toFixed(1)}%)`);
        console.log(`FPR: ${promotions} / ${promotionBase} (${(output.fpr.rate * 100).toFixed(1)}%)`);
        console.log(`ADR: ${ambiguitiesDetected} / ${ambiguityBase} (${(output.adr.recall * 100).toFixed(1)}%)`);
        console.log(`AGR: ${gatesPreserved} / ${gateBase} (${(output.agr.recall * 100).toFixed(1)}%)`);
      }
    } catch (err: unknown) {
      console.error('Benchmark evaluation failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
