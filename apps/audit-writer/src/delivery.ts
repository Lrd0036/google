import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`; }
export function auditObject(event: unknown): { bytes: Buffer; sha256: string; object: string } {
  const bytes = Buffer.from(canonicalJson(event));
  const hex = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256: `sha256:${hex}`, object: `sha256/${hex}.audit.json` };
}
