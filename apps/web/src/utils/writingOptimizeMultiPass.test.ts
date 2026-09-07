import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WRITING_OPTIMIZE_RUN_PREFS,
  WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK,
  clampWritingOptimizePassCount,
  formatWritingOptimizePassLabel,
  loadWritingOptimizeRunPrefs,
  parseWritingOptimizeRunPrefs,
  resolveDraftSourceText,
  saveWritingOptimizeRunPrefs,
} from './writingOptimizeMultiPass';

test('clampWritingOptimizePassCount keeps values in 1-3', () => {
  assert.equal(clampWritingOptimizePassCount(1), 1);
  assert.equal(clampWritingOptimizePassCount(3), 3);
  assert.equal(clampWritingOptimizePassCount(0), 1);
  assert.equal(clampWritingOptimizePassCount(9), 3);
  assert.equal(clampWritingOptimizePassCount('2'), 2);
  assert.equal(clampWritingOptimizePassCount('nope'), 1);
});

test('parseWritingOptimizeRunPrefs fills defaults', () => {
  assert.deepEqual(parseWritingOptimizeRunPrefs(null), DEFAULT_WRITING_OPTIMIZE_RUN_PREFS);
  const parsed = parseWritingOptimizeRunPrefs({
    autoStartDraft: true,
    planPassCount: 2,
    draftPassCount: 3,
  });
  assert.equal(parsed.autoStartDraft, true);
  assert.equal(parsed.planPassCount, 2);
  assert.equal(parsed.draftPassCount, 3);
});

test('load and save writing optimize run prefs round-trip', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  assert.deepEqual(loadWritingOptimizeRunPrefs(storage), DEFAULT_WRITING_OPTIMIZE_RUN_PREFS);
  saveWritingOptimizeRunPrefs(
    { autoStartDraft: true, planPassCount: 2, draftPassCount: 2 },
    storage
  );
  const loaded = loadWritingOptimizeRunPrefs(storage);
  assert.equal(loaded.autoStartDraft, true);
  assert.equal(loaded.planPassCount, 2);
  assert.equal(loaded.draftPassCount, 2);
});

test('resolveDraftSourceText only returns previous draft from pass 2', () => {
  assert.equal(resolveDraftSourceText(1, '上一稿'), undefined);
  assert.equal(resolveDraftSourceText(2, '  上一稿  '), '上一稿');
  assert.equal(resolveDraftSourceText(2, '   '), undefined);
});

test('formatWritingOptimizePassLabel names the current pass', () => {
  assert.match(formatWritingOptimizePassLabel('plan', 1, 1), /优化方案/);
  assert.equal(formatWritingOptimizePassLabel('plan', 2, 3), '方案第 2 / 3 轮');
  assert.equal(formatWritingOptimizePassLabel('draft', 1, 2), '正文第 1 / 2 轮');
});

test('plan refine feedback forbids a new plan and body', () => {
  assert.match(WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK, /不得另起/);
  assert.match(WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK, /不得输出章节正文/);
  assert.ok(WRITING_OPTIMIZE_PLAN_REFINE_FEEDBACK.length <= 2000);
});
