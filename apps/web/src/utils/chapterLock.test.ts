import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterItem } from '../services/api';
import { applyChapterLockResult, chapterLockActionLabel } from './chapterLock';

function makeChapter(chapterNo: number, overrides: Partial<ChapterItem> = {}): ChapterItem {
  return {
    chapterNo,
    title: `第${chapterNo}章 标题`,
    content: `第${chapterNo}章正文`,
    summary: `第${chapterNo}章摘要`,
    summarySource: 'llm',
    updatedAt: '2026-11-15T00:00:00.000Z',
    isLocked: false,
    ...overrides,
  };
}

const TARGET = { projectId: 'p-lock-1', chapterNo: 2 };

test('AQ-396：已锁定章节的操作文案为「解锁」', () => {
  assert.equal(chapterLockActionLabel(true), '解锁');
});

test('AQ-396：未锁定与缺失字段的操作文案为「锁定」', () => {
  assert.equal(chapterLockActionLabel(false), '锁定');
  assert.equal(chapterLockActionLabel(undefined), '锁定');
});

test('AQ-396：服务端确认后仅更新目标章节 isLocked，其余字段保持不变', () => {
  const chapters = [makeChapter(1), makeChapter(2), makeChapter(3)];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 2,
    isLocked: true,
  });

  assert.equal(result[1]!.isLocked, true);
  assert.equal(result[1]!.title, chapters[1]!.title);
  assert.equal(result[1]!.content, chapters[1]!.content);
  assert.equal(result[1]!.summary, chapters[1]!.summary);
  assert.equal(result[1]!.updatedAt, chapters[1]!.updatedAt);
  assert.equal(result[0]!.isLocked, false);
  assert.equal(result[2]!.isLocked, false);
});

test('AQ-396：回写不修改原数组，其他章节保持引用', () => {
  const chapters = [makeChapter(1), makeChapter(2)];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 2,
    isLocked: true,
  });

  assert.notEqual(result, chapters);
  assert.equal(chapters[1]!.isLocked, false);
  assert.equal(result[0], chapters[0]);
});

test('AQ-396：解锁确认将 true 恢复为 false', () => {
  const chapters = [makeChapter(2, { isLocked: true })];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 2,
    isLocked: false,
  });
  assert.equal(result[0]!.isLocked, false);
});

test('AQ-396：重复确认同一目标值不反转状态', () => {
  let chapters = [makeChapter(2)];
  chapters = applyChapterLockResult(chapters, TARGET, 'p-lock-1', { chapterNo: 2, isLocked: true });
  chapters = applyChapterLockResult(chapters, TARGET, 'p-lock-1', { chapterNo: 2, isLocked: true });
  assert.equal(chapters[0]!.isLocked, true);
});

test('AQ-396：项目已切换时忽略过期项目的响应', () => {
  const chapters = [makeChapter(2)];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-2', {
    chapterNo: 2,
    isLocked: true,
  });
  assert.equal(result, chapters);
  assert.equal(result[0]!.isLocked, false);
});

test('AQ-396：响应章号与目标不一致时不应用', () => {
  const chapters = [makeChapter(2), makeChapter(3)];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 3,
    isLocked: true,
  });
  assert.equal(result, chapters);
});

test('AQ-396：目标章节已被删除时原样返回', () => {
  const chapters = [makeChapter(1), makeChapter(3)];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 2,
    isLocked: true,
  });
  assert.deepEqual(
    result.map((chapter) => chapter.isLocked),
    [false, false]
  );
});

test('AQ-396：旧数据缺失 isLocked 字段时按未锁定处理并可锁定', () => {
  const legacy = makeChapter(2) as Partial<ChapterItem>;
  delete legacy.isLocked;
  const chapters = [legacy as ChapterItem];

  assert.equal(chapterLockActionLabel(chapters[0]!.isLocked), '锁定');
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', {
    chapterNo: 2,
    isLocked: true,
  });
  assert.equal(result[0]!.isLocked, true);
});

test('AQ-396：响应缺失 isLocked 时按未锁定回写', () => {
  const chapters = [makeChapter(2, { isLocked: true })];
  const result = applyChapterLockResult(chapters, TARGET, 'p-lock-1', { chapterNo: 2 });
  assert.equal(result[0]!.isLocked, false);
});

test('AQ-396：toggleLock emit 与父级 toggle-lock 监听命名对齐', () => {
  const toKebab = (name: string) => name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
  assert.equal(toKebab('toggleLock'), 'toggle-lock');
});
