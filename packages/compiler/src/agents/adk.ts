import { InMemoryRunner, LlmAgent, PolicyOutcome, SecurityPlugin, isFinalResponse, type BasePolicyEngine, type PolicyCheckResult, type ToolCallPolicyContext } from '@google/adk';
import type { Content, Schema } from '@google/genai';
import type { GeminiGenerateRequest, GeminiTransport } from '../semantic/extraction.js';
import { GoogleGenAiSdkTransport } from '../semantic/genai-sdk.js';
import { isLiveGeminiConfigured, liveGeminiApiKey, liveGeminiLocation } from '../semantic/live-env.js';

/** Policy engine that never authorizes a tool call. Interpreter agents must not gain capabilities. */
export class DenyAllPolicyEngine implements BasePolicyEngine {
  async evaluate(_context: ToolCallPolicyContext): Promise<PolicyCheckResult> {
    return { outcome: PolicyOutcome.DENY, reason: 'Interpreter agents cannot invoke tools or capabilities.' };
  }
}

export function createToolLessInterpreterAgent(options: { name: string; instruction: string; model: string; outputSchema: Record<string, unknown> }): LlmAgent {
  return new LlmAgent({
    name: options.name,
    description: 'Structured interpretation only. This agent has no tools and cannot invoke capabilities.',
    model: options.model,
    instruction: options.instruction,
    tools: [],
    includeContents: 'none',
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    outputSchema: options.outputSchema as Schema,
    generateContentConfig: { temperature: 0, responseMimeType: 'application/json' },
    beforeToolCallback: () => {
      throw new Error('AGENT_HAS_NO_TOOLS');
    },
  });
}

function userContent(contents: unknown): Content {
  if (Array.isArray(contents) && contents[0] && typeof contents[0] === 'object') {
    const first = contents[0] as { role?: string; parts?: Array<{ text?: string }> };
    if (Array.isArray(first.parts)) return { role: 'user', parts: first.parts };
  }
  return { role: 'user', parts: [{ text: JSON.stringify(contents) }] };
}

function eventText(event: { content?: { parts?: Array<{ text?: string | null }> } }): string {
  return (event.content?.parts ?? []).map((part) => part.text).filter((value): value is string => Boolean(value)).join('');
}

/**
 * Google ADK transport: an LlmAgent with an empty tool list produces structured
 * JSON. The model never receives a capability, HTTP client, or shell.
 */
export class AdkStructuredTransport implements GeminiTransport {
  async generate(request: GeminiGenerateRequest): Promise<unknown> {
    if (liveGeminiApiKey() && !process.env.GOOGLE_GENAI_API_KEY) process.env.GOOGLE_GENAI_API_KEY = liveGeminiApiKey();
    const agent = createToolLessInterpreterAgent({
      name: 'runbook_interpreter',
      instruction: request.systemInstruction,
      model: request.model,
      outputSchema: request.responseSchema,
    });
    if (agent.tools.length !== 0) throw new Error('AGENT_HAS_NO_TOOLS');
    const runner = new InMemoryRunner({
      appName: 'runbook-compiler',
      agent,
      plugins: [new SecurityPlugin({ policyEngine: new DenyAllPolicyEngine() })],
    });
    let text = '';
    for await (const event of runner.runEphemeral({ userId: 'runtime', newMessage: userContent(request.contents) })) {
      const next = eventText(event);
      if (next && (isFinalResponse(event) || !text)) text = next;
    }
    if (!text) throw new Error('Gemini response did not contain structured text');
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }
}

/** Prefer ADK (listed agent framework). Fall back to the GenAI SDK client if ADK is unavailable. */
export function createLiveModelTransport(): GeminiTransport {
  if (!isLiveGeminiConfigured()) throw new Error('LIVE_GEMINI_NOT_CONFIGURED');
  if (liveGeminiApiKey() && !process.env.GOOGLE_GENAI_API_KEY) process.env.GOOGLE_GENAI_API_KEY = liveGeminiApiKey();
  if (!process.env.GOOGLE_CLOUD_LOCATION && !process.env.GCP_REGION) process.env.GOOGLE_CLOUD_LOCATION = liveGeminiLocation();
  return process.env.LIVE_GEMINI_TRANSPORT === 'genai-sdk' ? new GoogleGenAiSdkTransport() : new AdkStructuredTransport();
}
