import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGenAiSdkTransport } from './genai-sdk.js';
import { GeminiFetchTransport } from './extraction.js';

test('Google GenAI SDK transport returns structured candidate text', async () => {
  const transport = new GoogleGenAiSdkTransport(() => ({
    models: {
      generateContent: async (params) => {
        assert.equal(params.model, 'gemini-3.5-flash');
        const config = params.config as { responseMimeType?: string; tools?: unknown };
        assert.equal(config.responseMimeType, 'application/json');
        assert.equal(config.tools, undefined);
        return { text: '{"decision":"UNKNOWN"}' };
      },
    },
  }));
  const response = await transport.generate({
    model: 'gemini-3.5-flash',
    systemInstruction: 'classify',
    contents: [{ role: 'user', parts: [{ text: '503' }] }],
    responseSchema: { type: 'object' },
  });
  const text = (response as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }).candidates[0]?.content.parts[0]?.text;
  assert.equal(text, '{"decision":"UNKNOWN"}');
});

test('REST transport keeps the API key out of the request URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://example.test/v1/models/gemini-test:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-api-key');
    return new Response('{}', { status: 200 });
  };
  try {
    const transport = new GeminiFetchTransport('test-api-key', 'https://example.test/v1');
    await transport.generate({
      model: 'gemini-test',
      systemInstruction: 'classify',
      contents: [],
      responseSchema: { type: 'object' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
