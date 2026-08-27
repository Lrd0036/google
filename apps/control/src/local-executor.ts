import type { RBIRDocument, RBIRNode } from '@runbook/types';
import { applyJudgmentPolicy, modelJudgmentFromContext } from '@runbook/compiler';

export interface LocalActionResult { status: string; response?: unknown; operation_id?: string; }
export type LocalActionDispatcher = (node: RBIRNode, params: Record<string, unknown>, attempt: number) => Promise<LocalActionResult>;
export type LocalJudgmentFn = (node: RBIRNode, context: Record<string, unknown>) => Promise<string>;
export interface LocalExecutionResult { status: 'COMPLETED' | 'HALTED' | 'SUSPENDED_APPROVAL' | 'FAILED'; current_node: string; trace: string[]; context: Record<string, unknown>; error?: string; }

function pointer(context: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('/context/')) throw new Error(`INVALID_CONTEXT_POINTER:${ref}`);
  let value: unknown = context;
  for (const part of ref.slice('/context/'.length).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !(key in value)) throw new Error(`MISSING_CONTEXT_VALUE:${ref}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function resolveBinding(value: unknown, context: Record<string, unknown>): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const binding = value as Record<string, unknown>;
    if (typeof binding.ref === 'string') return pointer(context, binding.ref);
    if ('literal' in binding) return binding.literal;
  }
  return value;
}

function transition(document: RBIRDocument, node: RBIRNode, outcome: string): string {
  if (!node.outcomes.includes(outcome)) throw new Error(`UNDECLARED_OUTCOME:${node.id}:${outcome}`);
  const edges = document.edges.filter((edge) => edge.from === node.id && edge.on === outcome);
  if (edges.length !== 1) throw new Error(`INVALID_TRANSITION:${node.id}:${outcome}`);
  return edges[0]!.to;
}

/** Offline control-plane runner for compiled RBIR; it never chooses a capability. */
export async function executeLocally(document: RBIRDocument, initialContext: Record<string, unknown>, dispatch: LocalActionDispatcher, maxSteps = 100, startNodeId = document.entry_node, judge?: LocalJudgmentFn): Promise<LocalExecutionResult> {
  const context = structuredClone(initialContext) as Record<string, unknown>;
  context.executed_capabilities ??= [];
  const trace: string[] = [];
  let nodeId = startNodeId;
  const attempts = new Map<string, number>();
  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error(`UNKNOWN_NODE:${nodeId}`);
      trace.push(node.id);
      if (node.kind === 'TERMINAL') return { status: node.terminal?.status === 'RESOLVED' ? 'COMPLETED' : 'HALTED', current_node: node.id, trace, context };
      if (node.kind === 'HUMAN_APPROVAL') return { status: 'SUSPENDED_APPROVAL', current_node: node.id, trace, context };
      let outcome: string;
      if (node.kind === 'DETERMINISTIC') {
        const requested = context.failure_mode;
        if (typeof requested !== 'string' || !node.outcomes.includes(requested)) throw new Error(`UNMAPPED_DETERMINISTIC_CONTEXT:${node.id}`);
        outcome = requested;
      } else if (node.kind === 'AGENT_JUDGMENT') {
        const raw = judge
          ? await judge(node, context)
          : modelJudgmentFromContext(context);
        if (typeof raw !== 'string') throw new Error(`UNMAPPED_JUDGMENT:${node.id}`);
        outcome = applyJudgmentPolicy(raw, context, node.outcomes);
        if (!node.outcomes.includes(outcome)) throw new Error(`UNMAPPED_JUDGMENT:${node.id}`);
      } else if (node.kind === 'ACTION') {
        const attempt = (attempts.get(node.id) ?? 0) + 1;
        attempts.set(node.id, attempt);
        const params = Object.fromEntries(Object.entries(node.action?.parameters ?? {}).map(([key, value]) => [key, resolveBinding(value, context)]));
        const result = await dispatch(node, params, attempt);
        outcome = result.status === 'COMPLETED' ? (node.outcomes.includes('ACTION_SUCCEEDED') ? 'ACTION_SUCCEEDED' : node.outcomes[0]!) : (node.outcomes.includes('ACTION_FAILED') ? 'ACTION_FAILED' : node.outcomes.at(-1)!);
        context.results ??= {};
        (context.results as Record<string, unknown>)[node.id] = result.response ?? result;
        const executed = Array.isArray(context.executed_capabilities) ? context.executed_capabilities as string[] : [];
        executed.push(node.action?.capability ?? node.id);
        context.executed_capabilities = executed;
      } else if (node.kind === 'VERIFY') {
        const expected = Object.fromEntries(Object.entries(node.verify?.expected_state ?? {}).map(([key, value]) => [key, resolveBinding(value, context)]));
        const params = Object.fromEntries(Object.entries(node.verify?.expected_state ?? {}).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'ref' in (value as Record<string, unknown>)).map(([key, value]) => [key, resolveBinding(value, context)]));
        const result = await dispatch(node, params, attempts.get(node.id) ?? 1);
        const response = result.response as Record<string, unknown> | undefined;
        const verified = result.status === 'COMPLETED' && Object.entries(expected).every(([key, value]) => response?.[key] === value);
        outcome = verified && node.outcomes.includes('VERIFIED') ? 'VERIFIED' : (node.outcomes.includes('FAILED') ? 'FAILED' : node.outcomes[0]!);
      } else outcome = node.outcomes[0]!;
      nodeId = transition(document, node, outcome);
    }
    return { status: 'FAILED', current_node: nodeId, trace, context, error: 'MAX_STEPS_EXCEEDED' };
  } catch (error) {
    return { status: 'FAILED', current_node: nodeId, trace, context, error: error instanceof Error ? error.message : String(error) };
  }
}
