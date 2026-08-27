import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type CorpusClass = 'AUTHENTIC_NORMATIVE' | 'AUTHENTIC_OPERATIONAL' | 'STRUCTURED_CONTRACT' | 'CONSTRUCTED_GOLDEN' | 'ADVERSARIAL_MUTATION';
export type ContentMode = 'VERBATIM' | 'EXCERPT' | 'PARAPHRASE' | 'CONSTRUCTED';
export interface BenchmarkAnnotation {
  statement_id: string;
  span: { start_byte: number; end_byte: number };
  annotated_text: string;
  epistemic: 'MACHINE_OBSERVATION' | 'HUMAN_ASSERTION' | 'DERIVED_FACT' | 'POLICY_DECLARATION' | 'HYPOTHESIS';
  deontic: 'REQUIRED' | 'PERMITTED' | 'RECOMMENDED' | 'PROHIBITED' | 'OPTIONAL';
  execution_semantics: 'ACTION' | 'VERIFY' | 'HUMAN_APPROVAL' | 'AGENT_JUDGMENT' | 'DETERMINISTIC' | 'TERMINAL';
  consequential: boolean;
  expected_capability?: string;
  ambiguous?: boolean;
  authority_gate_required?: boolean;
  authority_role?: string;
  non_delegable?: boolean;
}
export interface AnnotationReview { reviewer_id: string; annotation_sha256: string; completed_at: string; }
export interface BenchmarkItem {
  schema_version: 'runbookbench/v0.1';
  id: string;
  corpus_class: CorpusClass;
  provenance: {
    publisher: string; title: string; source_url: string; immutable_ref?: string; retrieved_at: string;
    retrieved_sha256: string; excerpt_sha256: string; license_or_use_note: string;
    redistribution: 'PERMITTED' | 'RESTRICTED' | 'CONSTRUCTED'; content_mode: ContentMode;
    source_locator?: string; snapshot_path?: string;
  };
  annotation_state: 'ANNOTATION_PENDING' | 'ADJUDICATED';
  annotation_reviews: AnnotationReview[];
  adjudication?: { adjudicator_id: string; completed_at: string; annotation_sha256: string };
  source_text: string;
  annotations: BenchmarkAnnotation[];
}

export const CORPUS_CLASSES: readonly CorpusClass[] = ['AUTHENTIC_NORMATIVE', 'AUTHENTIC_OPERATIONAL', 'STRUCTURED_CONTRACT', 'CONSTRUCTED_GOLDEN', 'ADVERSARIAL_MUTATION'];
const authenticClasses = new Set<CorpusClass>(['AUTHENTIC_NORMATIVE', 'AUTHENTIC_OPERATIONAL']);
const constructedClasses = new Set<CorpusClass>(['STRUCTURED_CONTRACT', 'CONSTRUCTED_GOLDEN', 'ADVERSARIAL_MUTATION']);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
export interface CorpusValidationResult { valid: boolean; publishable: boolean; errors: string[]; blockers: string[]; corpus_sha256: string; }
export function sha256Bytes(value: string | Buffer): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)); }
function byteSlice(text: string, start: number, end: number): string { return Buffer.from(text, 'utf8').subarray(start, end).toString('utf8'); }

export function validateBenchmarkItem(item: BenchmarkItem, fileName = item.id, corpusDir?: string): { errors: string[]; blockers: string[] } {
  const errors: string[] = []; const blockers: string[] = []; const provenance = item.provenance;
  if (item.schema_version !== 'runbookbench/v0.1') errors.push(`${fileName}: unsupported schema_version`);
  if (!item.id || !CORPUS_CLASSES.includes(item.corpus_class)) errors.push(`${fileName}: valid id and corpus_class are required`);
  if (!item.source_text?.trim()) errors.push(`${fileName}: source_text must not be empty`);
  if (!provenance?.publisher || !provenance.title || !provenance.source_url || !provenance.license_or_use_note) errors.push(`${fileName}: complete provenance is required`);
  if (!isIsoDate(provenance?.retrieved_at ?? '')) errors.push(`${fileName}: provenance.retrieved_at must be ISO-8601`);
  if (!digestPattern.test(provenance?.retrieved_sha256 ?? '')) errors.push(`${fileName}: invalid retrieved_sha256`);
  if (!digestPattern.test(provenance?.excerpt_sha256 ?? '')) errors.push(`${fileName}: invalid excerpt_sha256`);
  if (provenance?.excerpt_sha256 !== sha256Bytes(item.source_text ?? '')) errors.push(`${fileName}: excerpt_sha256 does not match source_text`);
  if (authenticClasses.has(item.corpus_class)) {
    if (!['VERBATIM', 'EXCERPT', 'PARAPHRASE'].includes(provenance.content_mode)) errors.push(`${fileName}: authentic classes cannot use constructed content`);
    if (!/^https:\/\//.test(provenance.source_url) || /(?:example\.(?:com|invalid)|localhost)/i.test(provenance.source_url)) errors.push(`${fileName}: authentic source_url must be public HTTPS`);
    if (/^RunbookBench$/i.test(provenance.publisher)) errors.push(`${fileName}: authentic publisher cannot be RunbookBench`);
    if (!provenance.source_locator) errors.push(`${fileName}: authentic source requires source_locator`);
  }
  if (constructedClasses.has(item.corpus_class)) {
    if (provenance.content_mode !== 'CONSTRUCTED' || provenance.redistribution !== 'CONSTRUCTED') errors.push(`${fileName}: constructed classes require CONSTRUCTED provenance`);
    if (!provenance.source_url.startsWith('urn:runbookbench:')) errors.push(`${fileName}: constructed source_url must use the runbookbench URN namespace`);
    if (provenance.retrieved_sha256 !== provenance.excerpt_sha256) errors.push(`${fileName}: constructed retrieved/excerpt digests must match`);
  }
  if (provenance.snapshot_path) {
    const snapshot = corpusDir ? resolve(corpusDir, provenance.snapshot_path) : resolve(dirname(fileName), provenance.snapshot_path);
    if (!existsSync(snapshot)) errors.push(`${fileName}: snapshot_path does not exist`);
    else if (sha256Bytes(readFileSync(snapshot)) !== provenance.retrieved_sha256) errors.push(`${fileName}: snapshot hash does not match retrieved_sha256`);
  } else if (provenance.redistribution === 'PERMITTED') blockers.push(`${fileName}: redistributable source snapshot is missing`);
  const sourceBytes = Buffer.byteLength(item.source_text ?? '', 'utf8');
  if (!Array.isArray(item.annotations) || item.annotations.length === 0) errors.push(`${fileName}: at least one annotation is required`);
  for (const annotation of item.annotations ?? []) {
    if (annotation.span.start_byte < 0 || annotation.span.end_byte <= annotation.span.start_byte || annotation.span.end_byte > sourceBytes) errors.push(`${fileName}/${annotation.statement_id}: span is outside source_text UTF-8 bytes`);
    else if (byteSlice(item.source_text, annotation.span.start_byte, annotation.span.end_byte) !== annotation.annotated_text) errors.push(`${fileName}/${annotation.statement_id}: annotated_text does not match its byte span`);
    if (annotation.ambiguous && annotation.execution_semantics !== 'ACTION') errors.push(`${fileName}/${annotation.statement_id}: ambiguous flag must control an action`);
  }
  const reviewers = new Set((item.annotation_reviews ?? []).map((review) => review.reviewer_id));
  for (const review of item.annotation_reviews ?? []) if (!review.reviewer_id || !digestPattern.test(review.annotation_sha256) || !isIsoDate(review.completed_at)) errors.push(`${fileName}: invalid annotation review`);
  if (item.annotation_state !== 'ADJUDICATED' || reviewers.size < 2 || !item.adjudication) blockers.push(`${fileName}: ANNOTATION_PENDING requires two independent reviews and adjudication`);
  if (item.adjudication && (!digestPattern.test(item.adjudication.annotation_sha256) || !isIsoDate(item.adjudication.completed_at))) errors.push(`${fileName}: invalid adjudication record`);
  return { errors, blockers };
}

export function validateBenchmarkCorpus(items: BenchmarkItem[], corpusDir?: string, expectedCount = 12): CorpusValidationResult {
  const errors: string[] = []; const blockers: string[] = [];
  if (items.length !== expectedCount) errors.push(`expected ${expectedCount} items, found ${items.length}`);
  const ids = new Set<string>();
  for (const item of items) { if (ids.has(item.id)) errors.push(`duplicate item id '${item.id}'`); ids.add(item.id); const result = validateBenchmarkItem(item, item.id, corpusDir); errors.push(...result.errors); blockers.push(...result.blockers); }
  for (const corpusClass of CORPUS_CLASSES) if (!items.some((item) => item.corpus_class === corpusClass)) errors.push(`missing corpus class '${corpusClass}'`);
  return { valid: errors.length === 0, publishable: errors.length === 0 && blockers.length === 0, errors, blockers, corpus_sha256: sha256Bytes(canonicalJson(items)) };
}
export function loadBenchmarkCorpus(dirPath: string): BenchmarkItem[] { return readdirSync(dirPath).filter((file) => file.endsWith('.json')).sort().map((file) => JSON.parse(readFileSync(join(dirPath, file), 'utf8')) as BenchmarkItem); }
