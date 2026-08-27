import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BenchmarkAnnotation {
  statement_id: string;
  span: { start_byte: number; end_byte: number };
  epistemic: 'MACHINE_OBSERVATION' | 'HUMAN_ASSERTION' | 'DERIVED_FACT' | 'POLICY_DECLARATION' | 'HYPOTHESIS';
  deontic: 'REQUIRED' | 'PERMITTED' | 'RECOMMENDED' | 'PROHIBITED' | 'OPTIONAL';
  execution_semantics: 'ACTION' | 'VERIFY' | 'HUMAN_APPROVAL' | 'AGENT_JUDGMENT' | 'DETERMINISTIC' | 'TERMINAL';
  consequential: boolean;
  expected_capability?: string;
}

export interface BenchmarkItem {
  schema_version: 'runbookbench/v0.1';
  id: string;
  corpus_class:
    | 'AUTHENTIC_NORMATIVE'
    | 'AUTHENTIC_OPERATIONAL'
    | 'STRUCTURED_CONTRACT'
    | 'CONSTRUCTED_GOLDEN'
    | 'ADVERSARIAL_MUTATION';
  provenance: {
    publisher: string;
    title: string;
    source_url: string;
    retrieved_at: string;
    source_sha256: string;
    license_or_use_note: string;
    content_mode: 'FULL' | 'EXCERPT' | 'SYNTHETIC';
    source_locator?: string;
  };
  source_text: string;
  annotations: BenchmarkAnnotation[];
}

export function loadBenchmarkCorpus(dirPath: string): BenchmarkItem[] {
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  const items: BenchmarkItem[] = [];

  for (const file of files) {
    const content = readFileSync(join(dirPath, file), 'utf8');
    const parsed = JSON.parse(content) as BenchmarkItem;
    items.push(parsed);
  }

  return items;
}
