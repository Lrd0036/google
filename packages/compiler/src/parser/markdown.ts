import type { SourceSpan } from '@runbook/types';

export interface StructuralNode {
  kind: 'Heading' | 'Paragraph' | 'OrderedList' | 'ListItem' | 'Table' | 'BlockQuote' | 'CodeFence' | 'OpaqueBlock';
  text: string;
  span: SourceSpan;
  level?: number;
  headers?: string[];
  rows?: string[][];
  children?: StructuralNode[];
}

export interface DocumentAST {
  uri: string;
  sourceText: string;
  nodes: StructuralNode[];
}

/**
 * Deterministic line and block parser preserving byte spans and line/col locations.
 * Implements Q13 requirements from spec.md.
 */
export function parseMarkdownBlocks(sourceText: string, uri: string = 'runbook.md'): DocumentAST {
  const lines = sourceText.split('\n');
  const nodes: StructuralNode[] = [];

  let currentByte = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();
    const startByte = currentByte;
    const endByte = currentByte + Buffer.byteLength(rawLine, 'utf8');
    const lineNumber = i + 1;

    const span: SourceSpan = {
      uri,
      start: { line: lineNumber, column: 1, byte: startByte },
      end: { line: lineNumber, column: rawLine.length + 1, byte: endByte },
    };

    // Advance byte counter (+1 for newline if not last line)
    currentByte = endByte + 1;

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match && match[1] && match[2]) {
        nodes.push({
          kind: 'Heading',
          level: match[1].length,
          text: match[2].trim(),
          span,
        });
        continue;
      }
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      nodes.push({
        kind: 'ListItem',
        text: trimmed.replace(/^\d+\.\s+/, ''),
        span,
      });
      continue;
    }

    if (trimmed.startsWith('```')) {
      nodes.push({
        kind: 'CodeFence',
        text: trimmed,
        span,
      });
      continue;
    }

    if (trimmed.startsWith('>')) {
      nodes.push({
        kind: 'BlockQuote',
        text: trimmed.replace(/^>\s*/, ''),
        span,
      });
      continue;
    }

    nodes.push({
      kind: 'Paragraph',
      text: trimmed,
      span,
    });
  }

  return {
    uri,
    sourceText,
    nodes,
  };
}
