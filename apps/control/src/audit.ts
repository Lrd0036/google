import type { ExecutionDocument, RuntimeEvent } from './runtime.js';
import { verifyEventChain } from './runtime.js';

export interface LocalAuditBundle {
  schema: 'rb-audit-bundle/v0.1';
  exported_at: string;
  execution: ExecutionDocument;
  events: RuntimeEvent[];
  execution_header_hash: string;
  event_chain_valid: boolean;
  artifacts: Record<string, unknown>;
}

/** Builds a portable audit artifact; durable retention remains an infrastructure concern. */
export function buildAuditBundle(execution: ExecutionDocument, events: RuntimeEvent[], artifacts: Record<string, unknown> = {}, exportedAt = new Date().toISOString(), executionHeaderHash = execution.last_event_hash): LocalAuditBundle {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  return { schema: 'rb-audit-bundle/v0.1', exported_at: exportedAt, execution: structuredClone(execution), events: structuredClone(ordered), execution_header_hash: executionHeaderHash, event_chain_valid: verifyEventChain(executionHeaderHash, ordered), artifacts: structuredClone(artifacts) };
}
