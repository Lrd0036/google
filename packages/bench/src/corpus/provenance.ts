import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BenchmarkItem } from './loader.js';
import { sha256Bytes } from './loader.js';
export interface ProvenanceVerification { item_id: string; status: 'VERIFIED' | 'SOURCE_DRIFT' | 'SOURCE_UNAVAILABLE' | 'CONSTRUCTED'; expected: string; observed?: string; cache_path?: string; }
export async function fetchAndVerifySource(item: BenchmarkItem, cacheDir: string): Promise<ProvenanceVerification> {
  if (item.provenance.redistribution === 'CONSTRUCTED') return { item_id: item.id, status: 'CONSTRUCTED', expected: item.provenance.retrieved_sha256 };
  mkdirSync(cacheDir, { recursive: true });
  const response = await fetch(item.provenance.source_url, { redirect: 'follow', headers: { 'user-agent': 'RunbookBench-Provenance/0.1' } });
  if (!response.ok) return { item_id: item.id, status: 'SOURCE_UNAVAILABLE', expected: item.provenance.retrieved_sha256 };
  const bytes = Buffer.from(await response.arrayBuffer());
  const cachePath = join(cacheDir, `${item.id}-${basename(new URL(item.provenance.source_url).pathname) || 'source'}`);
  writeFileSync(cachePath, bytes);
  const observed = sha256Bytes(bytes);
  return { item_id: item.id, status: observed === item.provenance.retrieved_sha256 ? 'VERIFIED' : 'SOURCE_DRIFT', expected: item.provenance.retrieved_sha256, observed, cache_path: cachePath };
}
export function verifyCachedSource(item: BenchmarkItem, cachePath: string): ProvenanceVerification { const observed = sha256Bytes(readFileSync(cachePath)); return { item_id: item.id, status: observed === item.provenance.retrieved_sha256 ? 'VERIFIED' : 'SOURCE_DRIFT', expected: item.provenance.retrieved_sha256, observed, cache_path: cachePath }; }
