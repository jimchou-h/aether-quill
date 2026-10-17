import assert from 'node:assert/strict';
import test from 'node:test';
import { useChapterRefinementRun } from './useChapterRefinementRun';
import type { apiClient, ChapterItem } from '../services/api';

const CHAPTER = {
  chapterNo: 1,
  title: '第一章',
  content: '正文',
  updatedAt: '2026-10-06T10:00:00.000Z',
} as unknown as ChapterItem;

const READY_VIEW = {
  runId: 'run-1',
  chapterNo: 1,
  status: 'ready',
  phase: 'finished',
  revision: 3,
  storageMode: 'memory',
  baseText: '正文',
  acceptedDraftText: '候选',
  sourceCurrent: true,
  baseUpdatedAt: '2026-10-06T10:00:00.000Z',
  rewritePolicy: 'preserve-plot',
  instruction: '收紧节奏',
  pauseReason: null,
  resumable: false,
  progress: { unitIndex: 0, unitTotal: 0, message: '' },
  issues: [],
  changes: [],
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};

/** 假 API：记录每次创建的 clientRequestId，其余方法返回稳定桩数据。 */
function makeFakeApi(create?: (clientRequestId: string) => Promise<unknown>) {
  const createdKeys: string[] = [];
  const fake = {
    async createChapterRefinementRun(
      _projectId: string,
      _chapterNo: number,
      payload: { clientRequestId: string }
    ) {
      createdKeys.push(payload.clientRequestId);
      if (create) {
        return create(payload.clientRequestId);
      }
      return {
        runId: `run-${createdKeys.length}`,
        chapterNo: 1,
        status: 'running',
        storageMode: 'memory',
        rewritePolicy: 'preserve-plot',
      };
    },
    async getChapterRefinementRun() {
      return READY_VIEW;
    },
    async listChapterRefinementRuns() {
      return [];
    },
    async observeChapterRefinementRunSSE() {
      return undefined;
    },
  };
  return { fake: fake as unknown as typeof apiClient, createdKeys };
}

function makeComposable(fake: typeof apiClient) {
  const composable = useChapterRefinementRun({
    projectId: () => 'p1',
    chapter: () => CHAPTER,
    api: fake,
  });
  composable.instruction.value = '收紧节奏';
  return composable;
}

test('W2 同面板再次启动：分配新的 clientRequestId（不命中旧 run）', async () => {
  const { fake, createdKeys } = makeFakeApi();
  const composable = makeComposable(fake);

  await composable.start();
  assert.equal(createdKeys.length, 1);
  // 首次运行完成（ready）后可再次启动
  assert.equal(composable.canStart.value, true);

  await composable.start();
  assert.equal(createdKeys.length, 2);
  assert.notEqual(createdKeys[0], createdKeys[1], '再次启动必须是新的逻辑运行，使用新 key');
});

test('W2 创建失败重试：保留同一 clientRequestId（幂等）', async () => {
  let attempt = 0;
  const { fake, createdKeys } = makeFakeApi(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('网络中断');
    }
    return {
      runId: 'run-ok',
      chapterNo: 1,
      status: 'running',
      storageMode: 'memory',
      rewritePolicy: 'preserve-plot',
    };
  });
  const composable = makeComposable(fake);

  await composable.start();
  await composable.start();

  assert.equal(createdKeys.length, 2);
  assert.equal(createdKeys[0], createdKeys[1], '同一次创建请求的重试必须复用同一幂等键');
});

test('W2 reset 后再次启动：分配新的 clientRequestId', async () => {
  const { fake, createdKeys } = makeFakeApi();
  const composable = makeComposable(fake);

  await composable.start();
  composable.reset();
  composable.instruction.value = '收紧节奏';
  await composable.start();

  assert.equal(createdKeys.length, 2);
  assert.notEqual(createdKeys[0], createdKeys[1]);
});
