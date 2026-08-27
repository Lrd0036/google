/** Resolve Gemini Developer API / Vertex configuration without inventing credentials. */
export function liveGeminiApiKey(): string | undefined {
  const key = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return key && key.trim().length > 0 ? key : undefined;
}

export function isLiveGeminiConfigured(): boolean {
  const vertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === '1' || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
    || process.env.GOOGLE_GENAI_USE_ENTERPRISE === '1' || process.env.GOOGLE_GENAI_USE_ENTERPRISE === 'true';
  return Boolean(liveGeminiApiKey()) || vertex;
}

export function liveGeminiModel(defaultModel = 'gemini-3.5-flash'): string {
  return process.env.GEMINI_MODEL || process.env.GOOGLE_GENAI_MODEL || defaultModel;
}

/** Gemini 3.5 on Vertex is published at `global`, not `us-central1`. */
export function liveGeminiLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_REGION || 'global';
}
