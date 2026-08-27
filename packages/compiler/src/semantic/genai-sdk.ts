import { GoogleGenAI } from '@google/genai';
import type { GeminiGenerateRequest, GeminiTransport } from './extraction.js';
import { liveGeminiApiKey, liveGeminiLocation } from './live-env.js';

export interface GenAiSdkClient {
  models: { generateContent: (params: Record<string, unknown>) => Promise<{ text?: string | null }> };
}

function defaultClient(): GenAiSdkClient {
  const vertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === '1' || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
  return new GoogleGenAI({
    apiKey: vertex ? undefined : liveGeminiApiKey(),
    vertexai: vertex,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: liveGeminiLocation(),
  }) as unknown as GenAiSdkClient;
}

/** Gemini Developer API / Vertex transport via the listed Google GenAI SDK. */
export class GoogleGenAiSdkTransport implements GeminiTransport {
  public constructor(private readonly clientFactory: () => GenAiSdkClient = defaultClient) {}

  async generate(request: GeminiGenerateRequest): Promise<unknown> {
    const response = await this.clientFactory().models.generateContent({
      model: request.model,
      contents: request.contents,
      config: {
        systemInstruction: request.systemInstruction,
        temperature: request.temperature ?? 0,
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseJsonSchema: request.responseSchema,
        abortSignal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
      },
    });
    const text = response.text;
    if (!text) throw new Error('Gemini response did not contain structured text');
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }
}
