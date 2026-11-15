import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import axios from 'axios';
import { ProjectsService } from './projects.service';

function sse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function generateWithOrchestratorEvents(events: string[]) {
  const originalPost = axios.post;
  axios.post = (async () => ({
    data: Readable.from(events.map((event) => Buffer.from(event))),
  })) as typeof axios.post;
  try {
    const service = Object.create(ProjectsService.prototype) as ProjectsService;
    const generateSegment = service as unknown as {
      generateOptimizeDraftSegment(input: Record<string, unknown>): Promise<{
        ok: boolean;
        segmentText: string;
        errorMessage?: string;
      }>;
    };
    return await generateSegment.generateOptimizeDraftSegment({
      projectId: 'test-project',
      prompt: '请直接改写',
      chapterNo: 1,
      chapterTitle: '样章',
      chapterSummaryForRetrieval: '',
      instruction: '保留事实',
      optimizationMode: 'single',
      segmentIndex: 0,
      segmentTotal: 1,
      inputSegmentChars: 20,
      maxTokens: 4096,
      streamToClient: true,
      templateKey: 'chapter.optimize.direct-draft',
    });
  } finally {
    axios.post = originalPost;
  }
}

test('direct rewrite rejects partial orchestrator SSE with no end event', async () => {
  const result = await generateWithOrchestratorEvents([
    sse({ event: 'content', data: '他推开门，却还没写到结尾。' }),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.errorMessage ?? '', /未完成|断流|结束标记/);
});

test('direct rewrite accepts orchestrator SSE with end event', async () => {
  const result = await generateWithOrchestratorEvents([
    sse({ event: 'content', data: '他推开门，走进屋里。' }),
    sse({ event: 'end', traceId: 'trace-1' }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.segmentText, '他推开门，走进屋里。');
});
