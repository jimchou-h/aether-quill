import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatChapterAfterSaveProgressMessage,
  formatChapterPendingActionsSummary,
} from './chapterAfterSave';
import type { ChapterPendingAction } from '../services/api';

test('formatChapterPendingActionsSummary joins action labels', () => {
  const actions: ChapterPendingAction[] = [
    { type: 'persona', label: '更新人物出场与状态', estimatedTokens: 800 },
    { type: 'relationEvents', label: '生成本章关系事件', estimatedTokens: 1200 },
  ];
  assert.match(formatChapterPendingActionsSummary(actions), /更新人物出场/);
  assert.match(formatChapterPendingActionsSummary(actions), /关系事件/);
});

test('formatChapterAfterSaveProgressMessage uses Chinese labels instead of raw action(status)', () => {
  assert.equal(
    formatChapterAfterSaveProgressMessage('relationEvents', 'processing', 7),
    '第 7 章：正在抽取关系事件…'
  );
  assert.equal(
    formatChapterAfterSaveProgressMessage('persona', 'completed', 7),
    '第 7 章已完成：更新人物出场与状态'
  );
  assert.equal(
    formatChapterAfterSaveProgressMessage('structuredInfo', 'failed', 7),
    '第 7 章后处理失败：解析结构化信息'
  );
  assert.doesNotMatch(
    formatChapterAfterSaveProgressMessage('summarize', 'processing', 3),
    /summarize\s*\(/
  );
});
