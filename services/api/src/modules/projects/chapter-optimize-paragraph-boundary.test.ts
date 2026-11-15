import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import axios from 'axios';
import { runContentSafetyPipeline } from './content-safety.pipeline';
import { ProjectsService } from './projects.service';

const PROJECT_ID = 'paragraph-boundary-test';
const FIRST_PARAGRAPH = '他放下手机。';
const SECOND_PARAGRAPH = '“收到消息了。”她说。';
const ORIGINAL_TEXT = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`;

type DraftCallbacks = Parameters<ProjectsService['optimizeChapterDraftStream']>[4];
type DraftStart = Parameters<DraftCallbacks['onStart']>[0];
type DraftEnd = Parameters<DraftCallbacks['onEnd']>[0];
type OrchestratorEvent = Record<string, unknown>;

function completedSegment(text: string, traceId: string): OrchestratorEvent[] {
  // 多个 token 本身不带分隔符，段界必须由章节编排层负责。
  return [
    { event: 'content', data: text.slice(0, 2) },
    { event: 'content', data: text.slice(2) },
    { event: 'end', traceId },
  ];
}

function createService(segmented: boolean): ProjectsService {
  // 不运行构造函数或读取业务存储，只保留真实编排、切分和 SSE 解析方法。
  const service = Object.create(ProjectsService.prototype) as ProjectsService;
  Object.assign(service, {
    knowledgeStore: new Map([
      [
        PROJECT_ID,
        {
          chapters: [
            {
              chapterNo: 1,
              title: '中性样章',
              content: ORIGINAL_TEXT,
              summary: '',
              updatedAt: new Date('2026-11-02T00:00:00.000Z'),
            },
          ],
        },
      ],
    ]),
    settingsStore: new Map([[PROJECT_ID, {}]]),
    personasStore: new Map([[PROJECT_ID, []]]),
    getProjectOrThrow: () => ({ id: PROJECT_ID }),
    ensureProjectState: () => undefined,
    resolveSelectedRelationEvents: () => [],
    syncProjectContextToOrchestrator: async () => undefined,
    resolveChapterOptimizeConfig: () => ({
      segmentationEnabled: segmented,
      singleSegmentThreshold: 0,
      segmentCharSize: Math.ceil(ORIGINAL_TEXT.length / 2),
    }),
    runContentSafetyForText: (_projectId: string, text: string, traceId: string, taskKey: string) =>
      runContentSafetyPipeline({ text, traceId, taskKey, enabled: false }),
  });
  return service;
}

async function generateDraft(input: {
  streams: OrchestratorEvent[][];
  segmented?: boolean;
  rewriteMode?: 'direct' | 'from-plan';
}) {
  const originalPost = axios.post;
  let generationCalls = 0;
  axios.post = (async () => {
    const events = input.streams[generationCalls++];
    assert.ok(events, '不应发起额外的编排或模型请求');
    return {
      data: Readable.from(events.map((event) => Buffer.from(`data: ${JSON.stringify(event)}\n\n`))),
    };
  }) as typeof axios.post;

  const starts: DraftStart[] = [];
  const ends: DraftEnd[] = [];
  const contents: string[] = [];
  const replacements: string[] = [];
  const errors: string[] = [];
  const segmentStarts: number[] = [];
  const rewriteMode = input.rewriteMode ?? 'direct';

  try {
    await createService(input.segmented ?? true).optimizeChapterDraftStream(
      PROJECT_ID,
      1,
      {
        instruction: '保留事件与段落结构，调整表达。',
        rewriteMode,
        ...(rewriteMode === 'from-plan' ? { planText: '保留事实，改善表达。' } : {}),
      },
      undefined,
      {
        onStart: (event) => starts.push(event),
        onContent: (text) => contents.push(text),
        onContentReplace: (text) => replacements.push(text),
        onSegmentStart: ({ segmentIndex }) => segmentStarts.push(segmentIndex),
        onEnd: (event) => ends.push(event),
        onError: (message) => errors.push(message),
      }
    );
    return { starts, ends, contents, replacements, errors, segmentStarts, generationCalls };
  } finally {
    axios.post = originalPost;
  }
}

for (const rewriteMode of ['direct', 'from-plan'] as const) {
  test(`${rewriteMode}: streamed blocks retain paragraph boundaries and end returns the merged draft`, async () => {
    const result = await generateDraft({
      rewriteMode,
      streams: [
        completedSegment(FIRST_PARAGRAPH, 'segment-1'),
        completedSegment(SECOND_PARAGRAPH, 'segment-2'),
      ],
    });

    assert.equal(result.generationCalls, 2);
    assert.equal(result.starts[0]?.optimizationMode, 'segmented');
    assert.equal(result.starts[0]?.segmentTotal, 2);
    assert.deepEqual(result.segmentStarts, [1, 2]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.replacements, [], '未发生后处理改写');
    assert.equal(result.contents.join(''), ORIGINAL_TEXT, '流式预览应在两块之间保留空行');
    assert.equal(result.ends.length, 1);
    assert.equal(result.ends[0].finalDraftText, ORIGINAL_TEXT, '成功终态应始终返回完整合并稿');
  });
}

test('single block retains internal blank lines without adding a leading separator', async () => {
  const result = await generateDraft({
    segmented: false,
    streams: [completedSegment(ORIGINAL_TEXT, 'single-segment')],
  });

  assert.equal(result.generationCalls, 1);
  assert.equal(result.starts[0]?.optimizationMode, 'single');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.replacements, []);
  assert.equal(result.contents.join(''), ORIGINAL_TEXT);
  assert.equal(result.ends.length, 1);
  assert.equal(result.ends[0].finalDraftText, ORIGINAL_TEXT);
});

test('an error in the second block does not emit a successful end', async () => {
  const result = await generateDraft({
    streams: [
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      [
        { event: 'content', data: '“收到' },
        { event: 'error', data: '模拟上游错误' },
      ],
    ],
  });

  assert.equal(result.generationCalls, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /模拟上游错误/);
  assert.deepEqual(result.ends, []);
});

test('an interrupted second block without an upstream end does not emit a successful end', async () => {
  const result = await generateDraft({
    streams: [
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      [{ event: 'content', data: '“收到' }],
    ],
  });

  assert.equal(result.generationCalls, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /未完成|断流|结束标记/);
  assert.deepEqual(result.ends, []);
});

test('an error before any second-block content leaves no dangling paragraph separator', async () => {
  const result = await generateDraft({
    streams: [
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      [{ event: 'error', data: '模拟第二块起始失败' }],
    ],
  });

  assert.equal(result.generationCalls, 2);
  assert.equal(result.contents.join(''), FIRST_PARAGRAPH, '失败块尚无正文，不应新增空行');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /模拟第二块起始失败/);
  assert.deepEqual(result.ends, []);
});

test('empty second-block content does not consume or duplicate the paragraph separator', async () => {
  const result = await generateDraft({
    streams: [
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      [
        { event: 'content', data: '' },
        { event: 'content', data: '' },
        { event: 'content', data: '“收到' },
        { event: 'content', data: '消息了。”' },
        { event: 'content', data: '她说。' },
        { event: 'end', traceId: 'segment-2' },
      ],
    ],
  });

  assert.equal(result.generationCalls, 2);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.replacements, []);
  assert.equal(result.contents.join(''), ORIGINAL_TEXT, '多片有效正文之间只保留一次块间空行');
  assert.equal(result.ends.length, 1);
  assert.equal(result.ends[0].finalDraftText, ORIGINAL_TEXT);
});
