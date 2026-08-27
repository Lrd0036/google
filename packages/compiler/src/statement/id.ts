import { createHash } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte === undefined) continue;
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function canonicalizeSemanticText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/[*_~`]/g, '') // remove markdown formatting
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Computes immutable, content-addressed statement ID according to spec Q14.
 * stmt_id = "stmt_" + Base32(SHA256(CanonicalSemanticText || NormalizedHeadingPath || StructuralRole))[0:16]
 */
export function computeStatementId(
  rawText: string,
  headingPath: string = '',
  structuralRole: string = 'PROCEDURAL'
): string {
  const canonicalText = canonicalizeSemanticText(rawText);
  const normalizedPath = headingPath.trim().toLowerCase();
  const role = structuralRole.trim().toUpperCase();

  const payload = `${canonicalText}|${normalizedPath}|${role}`;
  const hash = createHash('sha256').update(payload, 'utf8').digest();
  const base32 = toBase32(hash);

  return `stmt_${base32.slice(0, 16)}`;
}
