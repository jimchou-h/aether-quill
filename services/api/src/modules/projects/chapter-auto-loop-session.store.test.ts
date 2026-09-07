import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTO_LOOP_SESSION_TTL_MS,
  clearAutoLoopSessionsForTest,
  getAutoLoopSession,
  putAutoLoopSession,
} from './chapter-auto-loop-session.store';
import type { ChapterAutoLoopSession } from './chapter-auto-loop-session.store';

function makeSession(overrides: Partial<ChapterAutoLoopSession> = {}): ChapterAutoLoopSession {
  return {
    projectId: 'p1',
    chapterNo: 7,
    userId: 'u1',
    instruction: '让打斗更有临场感',
    roundBudget: 2,
    baseUpdatedAt: '2026-09-08T00:00:00.000Z',
    storedContent: '原文第一段。\n\n原文第二段。',
    rounds: [],
    finalDraft: '原文第一段。\n\n原文第二段。',
    stoppedReason: 'budget',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test('写入后可按 项目+章节+用户 读回', () => {
  clearAutoLoopSessionsForTest();
  const session = makeSession();
  putAutoLoopSession(session);
  const loaded = getAutoLoopSession('p1', 7, 'u1');
  assert.ok(loaded);
  assert.equal(loaded?.instruction, '让打斗更有临场感');
});

test('不同用户与不同章节互不串台', () => {
  clearAutoLoopSessionsForTest();
  putAutoLoopSession(makeSession({ instruction: '甲的会话' }));
  putAutoLoopSession(makeSession({ userId: 'u2', instruction: '乙的会话' }));
  putAutoLoopSession(makeSession({ chapterNo: 8, instruction: '第八章会话' }));

  assert.equal(getAutoLoopSession('p1', 7, 'u1')?.instruction, '甲的会话');
  assert.equal(getAutoLoopSession('p1', 7, 'u2')?.instruction, '乙的会话');
  assert.equal(getAutoLoopSession('p1', 8, 'u1')?.instruction, '第八章会话');
});

test('同键重复写入按最后一次覆盖', () => {
  clearAutoLoopSessionsForTest();
  putAutoLoopSession(makeSession({ roundBudget: 1 }));
  putAutoLoopSession(makeSession({ roundBudget: 3 }));
  assert.equal(getAutoLoopSession('p1', 7, 'u1')?.roundBudget, 3);
});

test('超过 TTL 的会话读回为空，不抛错', () => {
  clearAutoLoopSessionsForTest();
  const stale = new Date(Date.now() - AUTO_LOOP_SESSION_TTL_MS - 1000);
  putAutoLoopSession(makeSession({ createdAt: stale, updatedAt: stale }));
  assert.equal(getAutoLoopSession('p1', 7, 'u1'), undefined);
});

test('不存在的会话读回为空', () => {
  clearAutoLoopSessionsForTest();
  assert.equal(getAutoLoopSession('p1', 99, 'u1'), undefined);
});

test('缺少 userId 时不与真实用户会话混淆', () => {
  clearAutoLoopSessionsForTest();
  putAutoLoopSession(makeSession({ userId: undefined }));
  assert.ok(getAutoLoopSession('p1', 7, undefined));
  assert.equal(getAutoLoopSession('p1', 7, 'u1'), undefined);
});
