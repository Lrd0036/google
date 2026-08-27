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
  ambiguous?: boolean;
  authority_gate_required?: boolean;
  prohibited_reachable?: boolean;
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

export const CORPUS_CLASSES = [
  'AUTHENTIC_NORMATIVE',
  'AUTHENTIC_OPERATIONAL',
  'STRUCTURED_CONTRACT',
  'CONSTRUCTED_GOLDEN',
  'ADVERSARIAL_MUTATION',
] as const;

export interface CorpusValidationResult {
  valid: boolean;
  errors: string[];
}

function isDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function validateBenchmarkItem(item: BenchmarkItem, fileName = item.id): string[] {
  const errors: string[] = [];
  if (item.schema_version !== 'runbookbench/v0.1') errors.push(`${fileName}: unsupported schema_version`);
  if (!item.id) errors.push(`${fileName}: id is required`);
  if (!CORPUS_CLASSES.includes(item.corpus_class)) errors.push(`${fileName}: invalid corpus_class`);
  if (!item.source_text.trim()) errors.push(`${fileName}: source_text must not be empty`);
  if (!item.provenance?.publisher || !item.provenance.title || !item.provenance.source_url) {
    errors.push(`${fileName}: provenance publisher, title, and source_url are required`);
  }
  if (!isDate(item.provenance?.retrieved_at ?? '')) errors.push(`${fileName}: provenance.retrieved_at is not an ISO date`);
  if (!/^sha256:[a-f0-9]{64}$/.test(item.provenance?.source_sha256 ?? '')) errors.push(`${fileName}: invalid source_sha256`);
  if (!['FULL', 'EXCERPT', 'SYNTHETIC'].includes(item.provenance?.content_mode ?? '')) errors.push(`${fileName}: invalid content_mode`);
  const sourceBytes = Buffer.byteLength(item.source_text, 'utf8');
  for (const annotation of item.annotations ?? []) {
    if (annotation.span.start_byte < 0 || annotation.span.end_byte <= annotation.span.start_byte || annotation.span.end_byte > sourceBytes) {
      errors.push(`${fileName}/${annotation.statement_id}: span is outside source_text UTF-8 bytes`);
    }
    if (annotation.ambiguous && annotation.deontic !== 'REQUIRED' && annotation.execution_semantics !== 'ACTION') {
      errors.push(`${fileName}/${annotation.statement_id}: ambiguous flags must describe an executable mutation predicate`);
    }
  }
  return errors;
}

export function validateBenchmarkCorpus(items: BenchmarkItem[], expectedCount = 12): CorpusValidationResult {
  const errors: string[] = [];
  if (items.length !== expectedCount) errors.push(`expected ${expectedCount} items, found ${items.length}`);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) errors.push(`duplicate item id '${item.id}'`);
    ids.add(item.id);
    errors.push(...validateBenchmarkItem(item));
  }
  for (const corpusClass of CORPUS_CLASSES) {
    if (!items.some((item) => item.corpus_class === corpusClass)) errors.push(`missing corpus class '${corpusClass}'`);
  }
  return { valid: errors.length === 0, errors };
}

export function loadBenchmarkCorpus(dirPath: string): BenchmarkItem[] {
  const files = readdirSync(dirPath).filter((f) => f.endsWith('.json')).sort();
  const items: BenchmarkItem[] = [];

  for (const file of files) {
    const content = readFileSync(join(dirPath, file), 'utf8');
    const parsed = JSON.parse(content) as BenchmarkItem;
    const errors = validateBenchmarkItem(parsed, file);
    if (errors.length > 0) throw new Error(errors.join('\n'));
    items.push(parsed);
  }

  return items;
}
