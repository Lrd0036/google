import { z } from 'zod';
import type { StatementNode } from '../parser/markdown.js';

export const EpistemicClassSchema = z.enum(['FACT', 'OBSERVATION', 'POLICY', 'RECOMMENDATION', 'HYPOTHESIS', 'UNKNOWN']);
export const DeonticModalitySchema = z.enum(['REQUIRED', 'PROHIBITED', 'PERMITTED', 'RECOMMENDED', 'NONE']);
export const ExecutionSemanticSchema = z.enum(['ACTION', 'CONDITION', 'APPROVAL', 'VERIFICATION', 'TIMER', 'RETRY', 'CONTEXT', 'AMBIGUOUS']);
export type EpistemicClass = z.infer<typeof EpistemicClassSchema>;
export type DeonticModality = z.infer<typeof DeonticModalitySchema>;
export type ExecutionSemantic = z.infer<typeof ExecutionSemanticSchema>;

export const ExtractionSchema = z.object({
  statement_id: z.string(),
  epistemic_class: EpistemicClassSchema,
  deontic_modality: DeonticModalitySchema,
  execution_semantic: ExecutionSemanticSchema,
  roles: z.array(z.string()).max(10),
  conditions: z.array(z.string()).max(20),
  action_intent: z.string().nullable(),
  explicit_approvals: z.array(z.string()).max(10),
  prohibitions: z.array(z.string()).max(10),
  verification_obligations: z.array(z.string()).max(10),
  timers_or_retries: z.array(z.string()).max(10),
  ambiguity_flags: z.array(z.string()).max(10),
});
export type SemanticExtraction = z.infer<typeof ExtractionSchema>;

export const COMPILE_EXTRACTION_PROMPT = `SYSTEM PROFILE: RBK_EXTRACTION_V1
You extract candidate procedural semantics from supplied Markdown statements.
You do not decide what capabilities exist. You do not invent thresholds. You do not grant authority. You do not convert recommendations into requirements.
For every supplied statement ID return epistemic_class, deontic_modality, execution_semantic, roles, conditions, action_intent, explicit_approvals, prohibitions, verification_obligations, timers_or_retries, and ambiguity_flags.
Use AMBIGUOUS when the statement lacks enough information for executable semantics. Capability names are not part of this output. Return only the requested JSON array.`;

export interface GeminiGenerateRequest { model: string; systemInstruction: string; contents: unknown; responseSchema: Record<string, unknown>; temperature?: number; timeoutMs?: number; }
export interface GeminiTransport { generate(request: GeminiGenerateRequest): Promise<unknown>; }

/** Deterministic local transport for offline compilation tests and recorded demos. */
export class StaticGeminiTransport implements GeminiTransport {
  public constructor(private readonly responses: unknown[]) {}
  async generate(_request: GeminiGenerateRequest): Promise<unknown> {
    const response = this.responses.shift();
    if (response === undefined) throw new Error('LOCAL_MODEL_RESPONSES_EXHAUSTED');
    return response;
  }
}

export class GeminiFetchTransport implements GeminiTransport {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {}
  async generate(request: GeminiGenerateRequest): Promise<unknown> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);
    try {
      const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.systemInstruction }] }, contents: request.contents, generationConfig: { responseMimeType: 'application/json', responseSchema: request.responseSchema, candidateCount: 1, temperature: request.temperature ?? 0 } }) });
      if (!response.ok) throw new Error(`Gemini request failed with HTTP ${response.status}`);
      return response.json();
    } finally { clearTimeout(timeout); }
  }
}

function responseText(response: unknown): string {
  const candidate = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = candidate.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response did not contain structured text');
  return text;
}

export class GeminiSemanticExtractor {
  constructor(private readonly transport: GeminiTransport, private readonly model = 'gemini-3.5-flash') {}
  async extract(statements: StatementNode[]): Promise<SemanticExtraction[]> {
    const properties = {
      statement_id: { type: 'string' }, epistemic_class: { type: 'string', enum: EpistemicClassSchema.options }, deontic_modality: { type: 'string', enum: DeonticModalitySchema.options }, execution_semantic: { type: 'string', enum: ExecutionSemanticSchema.options },
      roles: { type: 'array', items: { type: 'string' } }, conditions: { type: 'array', items: { type: 'string' } }, action_intent: { type: ['string', 'null'] }, explicit_approvals: { type: 'array', items: { type: 'string' } }, prohibitions: { type: 'array', items: { type: 'string' } }, verification_obligations: { type: 'array', items: { type: 'string' } }, timers_or_retries: { type: 'array', items: { type: 'string' } }, ambiguity_flags: { type: 'array', items: { type: 'string' } },
    };
    const response = await this.transport.generate({ model: this.model, systemInstruction: COMPILE_EXTRACTION_PROMPT, contents: [{ role: 'user', parts: [{ text: JSON.stringify(statements.map((s) => ({ statement_id: s.statement_id, text: s.text, heading_path: s.heading_path, structural_role: s.structural_role }))) }] }], responseSchema: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['statement_id', 'epistemic_class', 'deontic_modality', 'execution_semantic', 'roles', 'conditions', 'action_intent', 'explicit_approvals', 'prohibitions', 'verification_obligations', 'timers_or_retries', 'ambiguity_flags'], properties } } });
    const parsed: unknown = JSON.parse(responseText(response));
    const result = z.array(ExtractionSchema).safeParse(parsed);
    if (!result.success) throw new Error(`MODEL_OUTPUT_INVALID: ${result.error.message}`);
    const allowed = new Set(statements.map((statement) => statement.statement_id));
    if (result.data.some((item) => !allowed.has(item.statement_id))) throw new Error('MODEL_OUTPUT_INVALID: unknown statement_id');
    return result.data;
  }
}
