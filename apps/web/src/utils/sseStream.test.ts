import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readSseSegments } from './sseStream';

function responseFromChunks(chunks: string[], hangAfter = false): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        return;
      }
      if (hangAfter) {
        await new Promise(() => {
          /* keep the HTTP body open, like a leaked SSE heartbeat */
        });
        return;
      }
      controller.close();
    },
  });
  return { body: stream } as Response;
}

describe('readSseSegments', () => {
  it('stops after the handler returns true even if the stream stays open', async () => {
    const seen: string[] = [];
    const read = readSseSegments(
      responseFromChunks(['data: {"event":"end"}\n\n', 'data: {"event":"extra"}\n\n'], true),
      (line) => {
        seen.push(line);
        return line.includes('"end"');
      }
    );

    await Promise.race([
      read,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for SSE stop')), 1000);
      }),
    ]);

    assert.deepEqual(seen, ['{"event":"end"}']);
  });

  it('awaits an async handler before stopping', async () => {
    let finished = false;
    await readSseSegments(responseFromChunks(['data: {"event":"end"}\n\n']), async (line) => {
      await Promise.resolve();
      finished = line.includes('"end"');
      return true;
    });
    assert.equal(finished, true);
  });
});
