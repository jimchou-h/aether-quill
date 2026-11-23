import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import axios from 'axios';
import { runContentSafetyPipeline } from './content-safety.pipeline';
import { ProjectsService } from './projects.service';

const PROJECT_ID = 'plot-context-test';
const FIRST_PARAGRAPH = '他潜入门厅，避开守卫。';
const SECOND_PARAGRAPH = '她在地牢里等着。';
const ORIGINAL_TEXT = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`;
const SYNOPSIS = '主角潜入地牢救人，结尾留下追兵伏笔。';

type DraftCallbacks = Parameters<ProjectsService['optimizeChapterDraftStream']>[4];
type DraftEnd = Parameters<DraftCallbacks['onEnd']>[0];
type OrchestratorEvent = Record<string, unknown>;

function sseEvents(events: OrchestratorEvent[]) {
  return Readable.from(events.map((event) => Buffer.from(`data: ${JSON.stringify(event)}\n\n`)));
}

function completedSegment(text: string, traceId: string): OrchestratorEvent[] {
  return [
    { event: 'content', data: text.slice(0, 2) },
    { event: 'content', data: text.slice(2) },
    { event: 'end', traceId },
  ];
}

function plotAnalysis(
  segments: Array<{ segmentIndex: number; plotChecklist: string[] }>
): OrchestratorEvent[] {
  return [
    { event: 'content', data: JSON.stringify({ chapterSynopsis: SYNOPSIS, segments }) },
    { event: 'end', traceId: 'plot-context' },
  ];
}

function validPlotAnalysis(): OrchestratorEvent[] {
  return plotAnalysis([
    { segmentIndex: 1, plotChecklist: ['潜入门厅', '避开守卫'] },
    { segmentIndex: 2, plotChecklist: ['在地牢等待救援'] },
  ]);
}

function createService(segmented: boolean): ProjectsService {
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

interface PostedCall {
  templateKey: string;
  prompt: string;
  task: string;
}

async function runDraft(input: {
  streams: OrchestratorEvent[][];
  segmented?: boolean;
  rewriteMode?: 'direct' | 'from-plan';
  signal?: AbortSignal;
}) {
  const originalPost = axios.post;
  const calls: PostedCall[] = [];
  axios.post = (async (_url: string, body: Record<string, unknown>) => {
    calls.push({
      templateKey: String(body.templateKey ?? ''),
      prompt: String(body.prompt ?? ''),
      task: String((body.context as Record<string, unknown> | undefined)?.task ?? ''),
    });
    const events = input.streams[calls.length - 1];
    assert.ok(events, '不应发起额外的编排或模型请求');
    return { data: sseEvents(events) };
  }) as typeof axios.post;

  const stages: string[] = [];
  const ends: DraftEnd[] = [];
  const contents: string[] = [];
  const errors: string[] = [];
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
        onStart: () => undefined,
        onStage: ({ stage }) => stages.push(stage),
        onContent: (text) => contents.push(text),
        onEnd: (event) => ends.push(event),
        onError: (message) => errors.push(message),
      },
      input.signal
    );
    return { calls, stages, ends, contents, errors };
  } finally {
    axios.post = originalPost;
  }
}

test('direct multi-segment: one plot analysis before the first body call', async () => {
  const result = await runDraft({
    streams: [
      validPlotAnalysis(),
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      completedSegment(SECOND_PARAGRAPH, 'segment-2'),
    ],
  });

  assert.equal(result.calls.length, 3);
  assert.equal(result.calls[0]?.templateKey, 'chapter.optimize.plot-context');
  assert.equal(result.calls[0]?.task, 'chapter.optimize.plot-context');
  assert.equal(result.calls[1]?.templateKey, 'chapter.optimize.direct-draft');
  assert.ok(result.stages.indexOf('preparing_plot_context') >= 0);
  assert.ok(
    result.stages.indexOf('preparing_plot_context') < result.stages.indexOf('draft_segment')
  );

  assert.match(result.calls[1]!.prompt, /【整章情节·只读】/);
  assert.match(result.calls[1]!.prompt, /潜入门厅/);
  assert.equal(result.calls[1]!.prompt.includes('在地牢等待救援'), false);

  assert.match(result.calls[2]!.prompt, /【整章情节·只读】/);
  assert.match(result.calls[2]!.prompt, /在地牢等待救援/);

  assert.deepEqual(result.errors, []);
  assert.equal(result.ends.length, 1);
});

test('plot analysis retries once after an invalid result', async () => {
  const result = await runDraft({
    streams: [
      [
        { event: 'content', data: '不是 JSON' },
        { event: 'end', traceId: 'plot-1' },
      ],
      validPlotAnalysis(),
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      completedSegment(SECOND_PARAGRAPH, 'segment-2'),
    ],
  });

  assert.equal(result.calls.length, 4);
  assert.equal(result.calls[0]?.templateKey, 'chapter.optimize.plot-context');
  assert.equal(result.calls[1]?.templateKey, 'chapter.optimize.plot-context');
  assert.equal(result.stages.filter((stage) => stage === 'preparing_plot_context').length, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ends.length, 1);
});

test('two failed analyses end the run before any body generation', async () => {
  const result = await runDraft({
    streams: [
      [
        { event: 'content', data: '不是 JSON' },
        { event: 'end', traceId: 'plot-1' },
      ],
      [
        { event: 'content', data: '{"chapterSynopsis":"","segments":[]}' },
        { event: 'end', traceId: 'plot-2' },
      ],
    ],
  });

  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.errors, ['情节梳理失败']);
  assert.deepEqual(result.contents, []);
  assert.deepEqual(result.ends, []);
});

test('from-plan segmentation keeps its existing flow without plot analysis', async () => {
  const result = await runDraft({
    rewriteMode: 'from-plan',
    streams: [
      completedSegment(FIRST_PARAGRAPH, 'segment-1'),
      completedSegment(SECOND_PARAGRAPH, 'segment-2'),
    ],
  });

  assert.equal(result.calls.length, 2);
  assert.ok(result.calls.every((call) => call.templateKey === 'chapter.optimize.draft'));
  assert.equal(
    result.calls.some((call) => call.templateKey === 'chapter.optimize.plot-context'),
    false
  );
  assert.equal(result.stages.includes('preparing_plot_context'), false);
  assert.equal(result.calls[0]!.prompt.includes('【整章情节·只读】'), false);
});

test('single-segment direct rewrite skips plot analysis', async () => {
  const result = await runDraft({
    segmented: false,
    streams: [completedSegment(ORIGINAL_TEXT, 'single')],
  });

  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.templateKey, 'chapter.optimize.direct-draft');
  assert.equal(result.stages.includes('preparing_plot_context'), false);
  assert.deepEqual(result.errors, []);
});

test('cancelling during plot analysis makes no model calls and no error toast', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runDraft({
    signal: controller.signal,
    streams: [],
  });

  assert.equal(result.calls.length, 0);
  assert.deepEqual(result.contents, []);
  assert.deepEqual(result.ends, []);
  assert.deepEqual(result.errors, []);
});
