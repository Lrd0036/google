import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBenchmarkCorpus, validateBenchmarkItem, type BenchmarkItem, sha256Bytes } from './loader.js';

function item(overrides: Partial<BenchmarkItem> = {}): BenchmarkItem {
  const source='Perform the reviewed action.';
  return { schema_version:'runbookbench/v0.1',id:'RB-TEST-001',corpus_class:'CONSTRUCTED_GOLDEN',provenance:{publisher:'RunbookBench',title:'test',source_url:'urn:runbookbench:test:001',retrieved_at:'2026-08-27T00:00:00Z',retrieved_sha256:sha256Bytes(source),excerpt_sha256:sha256Bytes(source),license_or_use_note:'constructed',redistribution:'CONSTRUCTED',content_mode:'CONSTRUCTED'},annotation_state:'ANNOTATION_PENDING',annotation_reviews:[],source_text:source,annotations:[{statement_id:'stmt_test',span:{start_byte:0,end_byte:Buffer.byteLength(source)},annotated_text:source,epistemic:'POLICY_DECLARATION',deontic:'REQUIRED',execution_semantics:'ACTION',consequential:true,expected_capability:'retry_job@1'}],...overrides };
}
test('draft corpus is structurally valid but cannot publish without two reviews and adjudication',()=>{ const result=validateBenchmarkItem(item()); assert.deepEqual(result.errors,[]); assert.match(result.blockers.join('\n'),/ANNOTATION_PENDING/); });
test('validator rejects mislabeled synthetic authentic sources, hash mismatch, and bad spans',()=>{ const value=item({corpus_class:'AUTHENTIC_OPERATIONAL'}); value.provenance={...value.provenance,publisher:'RunbookBench',source_url:'https://example.invalid/source',content_mode:'CONSTRUCTED',excerpt_sha256:`sha256:${'0'.repeat(64)}`}; value.annotations[0]!.annotated_text='wrong'; const result=validateBenchmarkItem(value); assert.match(result.errors.join('\n'),/authentic classes cannot|public HTTPS|publisher cannot|excerpt_sha256|annotated_text/); });
test('corpus class coverage and count are mandatory',()=>{ const result=validateBenchmarkCorpus([item()],undefined,12); assert.equal(result.valid,false); assert.match(result.errors.join('\n'),/expected 12|missing corpus class/); });
