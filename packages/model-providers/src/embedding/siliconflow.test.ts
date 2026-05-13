import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SiliconFlowEmbeddingProvider } from './siliconflow';

describe('SiliconFlowEmbeddingProvider', () => {
  it('parses OpenAI-compatible embedding response', async () => {
    const mockHttp = {
      post: async () => ({
        data: {
          data: [
            { index: 1, embedding: [0, 0, 1] },
            { index: 0, embedding: [1, 0, 0] },
          ],
          usage: { prompt_tokens: 12 },
        },
      }),
    };

    const provider = new SiliconFlowEmbeddingProvider(
      {
        apiBaseUrl: 'https://example.invalid',
        apiKey: 'k',
        model: 'm',
        timeoutMs: 1000,
      },
      mockHttp
    );

    const out = await provider.embed(['a', 'b']);
    assert.deepEqual(out.embeddings, [
      [1, 0, 0],
      [0, 0, 1],
    ]);
    assert.equal(out.inputTokens, 12);
  });

  it('maps HTTP failures to retriable code marker', async () => {
    const mockHttp = {
      post: async () => {
        throw new Error('timeout');
      },
    };
    const provider = new SiliconFlowEmbeddingProvider(
      {
        apiBaseUrl: 'https://example.invalid',
        apiKey: 'k',
        model: 'm',
        timeoutMs: 1000,
      },
      mockHttp
    );

    await assert.rejects(
      () => provider.embed(['x']),
      (err: unknown) =>
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === 'EMBEDDING_PROVIDER_UNAVAILABLE'
    );
  });
});
