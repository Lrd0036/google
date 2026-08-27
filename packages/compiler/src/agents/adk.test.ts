import assert from 'node:assert/strict';
import test from 'node:test';
import { DenyAllPolicyEngine, createToolLessInterpreterAgent } from './adk.js';
import { PolicyOutcome } from '@google/adk';

test('ADK interpreter agent is constructed with no tools', () => {
  const agent = createToolLessInterpreterAgent({
    name: 'runbook_interpreter',
    instruction: 'Return JSON only.',
    model: 'gemini-3.5-flash',
    outputSchema: { type: 'object', properties: { decision: { type: 'string' } } },
  });
  assert.equal(agent.tools.length, 0);
  assert.equal(agent.disallowTransferToParent, true);
  assert.equal(agent.disallowTransferToPeers, true);
});

test('deny-all policy engine never authorizes a tool call', async () => {
  const decision = await new DenyAllPolicyEngine().evaluate({ tool: { name: 'retry_job' } as never, toolArgs: {} });
  assert.equal(decision.outcome, PolicyOutcome.DENY);
});
