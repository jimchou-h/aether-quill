import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import axios from 'axios';
import { GenerationService } from './generation.service';

function providerChunk(content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`;
}

async function runDirectDraftStream(chunks: string[]) {
  const testDir = mkdtempSync(join(tmpdir(), 'aq-direct-stream-'));
  const originalCwd = process.cwd();
  process.chdir(testDir);
  const originalPost = axios.post;
  const originalKey = process.env.SILICONFLOW_API_KEY;
  let text = '';
  let error: unknown;
  try {
    const service = new GenerationService();
    const trace = await service.createTrace({
      projectId: 'test-project',
      prompt: '请直接改写这一章',
      model: 'Pro/deepseek-ai/DeepSeek-V3.2',
      context: { templateKey: 'chapter.optimize.direct-draft', generation_provider: 'siliconflow' },
    });
    process.env.SILICONFLOW_API_KEY = 'test-key';
    axios.post = (async () => ({
      status: 200,
      data: Readable.from(chunks.map((chunk) => Buffer.from(chunk))),
    })) as typeof axios.post;
    try {
      for await (const piece of service.generateStream(trace, {})) {
        text += piece;
      }
    } catch (caught) {
      error = caught;
    }
    return {
      text,
      error,
      status: service.getTrace(trace.id)?.status,
      finishReason: service.getTrace(trace.id)?.finishReason,
    };
  } finally {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = originalKey;
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  }
}

test('direct draft rejects provider output stopped by length even when text is nonempty', async () => {
  const run = await runDirectDraftStream([
    providerChunk('他推开门，却还没写到结尾。'),
    providerChunk('', 'length'),
    'data: [DONE]\n\n',
  ]);
  assert.match(String(run.error), /截断|长度|length/i);
  assert.equal(run.status, 'failed');
  assert.equal(run.finishReason, 'length');
});

test('direct draft rejects stream that ends without provider completion marker', async () => {
  const run = await runDirectDraftStream([providerChunk('他推开门，却还没写到结尾。')]);
  assert.match(String(run.error), /未完成|断流|结束标记/);
  assert.equal(run.status, 'failed');
});

test('direct draft accepts a normally completed provider stream', async () => {
  const run = await runDirectDraftStream([
    providerChunk('他推开门，'),
    providerChunk('走进屋里。', 'stop'),
    'data: [DONE]\n\n',
  ]);
  assert.equal(run.error, undefined);
  assert.equal(run.text, '他推开门，走进屋里。');
  assert.equal(run.status, 'completed');
});
