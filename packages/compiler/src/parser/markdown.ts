import type { SourceSpan } from '@runbook/types';
import { computeStatementId } from '../statement/id.js';

export type StructuralKind = 'Heading' | 'Paragraph' | 'OrderedList' | 'ListItem' | 'Table' | 'BlockQuote' | 'CodeFence' | 'OpaqueBlock';
export interface StructuralNode { kind: StructuralKind; text: string; span: SourceSpan; level?: number; headers?: string[]; rows?: string[][]; children?: StructuralNode[]; headingPath?: string[]; ordered?: boolean; }
export interface StatementNode { statement_id: string; text: string; structural_role: 'NORMATIVE' | 'PROCEDURAL' | 'CONTEXT' | 'EVIDENCE' | 'OPAQUE'; heading_path: string[]; source: SourceSpan; node_kind: StructuralKind; }
export interface DocumentAST { uri: string; sourceText: string; nodes: StructuralNode[]; statements: StatementNode[]; }
interface Line { text: string; start: number; end: number; number: number; }

function linesOf(sourceText: string): Line[] {
  const result: Line[] = []; let start = 0; const sourceLines = sourceText.split('\n');
  for (let index = 0; index < sourceLines.length; index += 1) { const rawText = sourceLines[index] ?? ''; const text = rawText.endsWith('\r') ? rawText.slice(0, -1) : rawText; const end = start + Buffer.byteLength(text, 'utf8'); result.push({ text, start, end, number: index + 1 }); start += Buffer.byteLength(rawText, 'utf8') + (index < sourceLines.length - 1 ? 1 : 0); }
  return result;
}
function span(uri: string, first: Line, last: Line): SourceSpan { return { uri, start: { line: first.number, column: 1, byte: first.start }, end: { line: last.number, column: last.text.length + 1, byte: last.end } }; }
function cell(value: string): string { return value.trim().replace(/^\|/, '').replace(/\|$/, '').trim(); }
function isTableSeparator(line: string): boolean { const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|'); return cells.length > 0 && cells.every((part) => /^\s*:?-{3,}:?\s*$/.test(part)); }
function isFence(line: string): boolean { return /^\s*(`{3,}|~{3,})/.test(line); }
function isHeading(line: string): RegExpMatchArray | null { return line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/); }
function isList(line: string): RegExpMatchArray | null { return line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/); }
function roleFor(node: StructuralNode): StatementNode['structural_role'] { if (node.kind === 'CodeFence') return 'OPAQUE'; if (node.kind === 'BlockQuote') return 'EVIDENCE'; return /\b(must|shall|required|不得|禁止|must not|shall not|do not|never)\b/i.test(node.text) ? 'NORMATIVE' : 'PROCEDURAL'; }

/** Parse Markdown blocks while preserving source locations; no prose becomes executable control flow here. */
export function parseMarkdownBlocks(sourceText: string, uri = 'runbook.md'): DocumentAST {
  const lines = linesOf(sourceText); const nodes: StructuralNode[] = []; const headingStack: string[] = []; let i = 0; const currentPath = (): string[] => [...headingStack];
  while (i < lines.length) {
    const line = lines[i]!; const trimmed = line.text.trim(); if (!trimmed) { i += 1; continue; }
    const heading = isHeading(line.text);
    if (heading?.[1] && heading[2]) { const level = heading[1].length; headingStack.splice(level - 1); headingStack.push(heading[2].trim()); nodes.push({ kind: 'Heading', level, text: heading[2].trim(), span: span(uri, line, line), headingPath: currentPath() }); i += 1; continue; }
    if (isFence(line.text)) { const opener = line.text.trim().slice(0, 3); let end = i; while (end + 1 < lines.length && !lines[end + 1]!.text.trim().startsWith(opener)) end += 1; if (end + 1 < lines.length) end += 1; nodes.push({ kind: 'CodeFence', text: lines.slice(i, end + 1).map((l) => l.text).join('\n'), span: span(uri, line, lines[end]!), headingPath: currentPath() }); i = end + 1; continue; }
    if (i + 1 < lines.length && trimmed.includes('|') && isTableSeparator(lines[i + 1]!.text)) { const headers = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell); let end = i + 1; const rows: string[][] = []; while (end + 1 < lines.length && lines[end + 1]!.text.trim().includes('|') && !isHeading(lines[end + 1]!.text)) { end += 1; rows.push(lines[end]!.text.replace(/^\s*\|?/, '').replace(/\|?\s*$/, '').split('|').map(cell)); } nodes.push({ kind: 'Table', text: headers.join(' | '), headers, rows, span: span(uri, line, lines[end]!), headingPath: currentPath() }); i = end + 1; continue; }
    const list = isList(line.text);
    if (list?.[2]) { const start = i; const children: StructuralNode[] = []; while (i < lines.length) { const itemLine = lines[i]!; const item = isList(itemLine.text); if (!item?.[2]) break; children.push({ kind: 'ListItem', text: item[2].trim(), span: span(uri, itemLine, itemLine), headingPath: currentPath(), ordered: /^\d/.test(item[1] ?? '') }); i += 1; } nodes.push({ kind: children[0]?.ordered ? 'OrderedList' : 'ListItem', text: children.map((child) => child.text).join('\n'), children, span: span(uri, lines[start]!, lines[i - 1]!), headingPath: currentPath(), ordered: children[0]?.ordered }); continue; }
    if (trimmed.startsWith('>')) { const start = i; while (i + 1 < lines.length && lines[i + 1]!.text.trim().startsWith('>')) i += 1; nodes.push({ kind: 'BlockQuote', text: lines.slice(start, i + 1).map((l) => l.text.trim().replace(/^>\s*/, '')).join('\n'), span: span(uri, lines[start]!, lines[i]!), headingPath: currentPath() }); i += 1; continue; }
    const start = i; while (i + 1 < lines.length) { const next = lines[i + 1]!; if (!next.text.trim() || isHeading(next.text) || isFence(next.text) || isList(next.text) || next.text.trim().startsWith('>')) break; i += 1; } nodes.push({ kind: 'Paragraph', text: lines.slice(start, i + 1).map((l) => l.text.trim()).join('\n'), span: span(uri, lines[start]!, lines[i]!), headingPath: currentPath() }); i += 1;
  }
  const statements: StatementNode[] = []; const add = (node: StructuralNode, text: string, role: StatementNode['structural_role']): void => { const path = node.headingPath ?? []; statements.push({ statement_id: computeStatementId(text, path.join(' > '), role), text, structural_role: role, heading_path: path, source: node.span, node_kind: node.kind }); };
  for (const node of nodes) { if (node.kind === 'Heading') continue; if (node.children?.length) node.children.forEach((child) => add(child, child.text, roleFor(child))); else if (node.kind === 'Table') node.rows?.forEach((row) => add(node, row.join(' | '), 'PROCEDURAL')); else add(node, node.text, roleFor(node)); }
  return { uri, sourceText, nodes, statements };
}
