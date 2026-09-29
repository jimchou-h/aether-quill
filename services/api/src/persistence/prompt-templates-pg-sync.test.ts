import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planPromptTemplateVersionWrites,
  shouldReplacePromptTemplateSnapshot,
} from './prompt-templates-pg-sync';

test('空快照不得覆盖已有模板', () => {
  assert.equal(shouldReplacePromptTemplateSnapshot({ existingCount: 30, incomingCount: 0 }), false);
});

test('initDefaults 只种出少量行时不得整表覆盖', () => {
  assert.equal(shouldReplacePromptTemplateSnapshot({ existingCount: 30, incomingCount: 3 }), false);
});

test('单条删除或空库灌入允许落盘', () => {
  assert.equal(shouldReplacePromptTemplateSnapshot({ existingCount: 30, incomingCount: 29 }), true);
  assert.equal(shouldReplacePromptTemplateSnapshot({ existingCount: 0, incomingCount: 3 }), true);
});

test('已有版本史只插入缺失版本，并在发布标记变化时重标', () => {
  const unchanged = planPromptTemplateVersionWrites({
    existing: [
      { version: 1, isPublished: false },
      { version: 2, isPublished: true },
    ],
    incoming: [
      { version: 1, content: 'a', createdAt: '2026-01-01T00:00:00.000Z', isPublished: false },
      { version: 2, content: 'b', createdAt: '2026-01-02T00:00:00.000Z', isPublished: true },
    ],
  });
  assert.deepEqual(unchanged.toInsert, []);
  assert.equal(unchanged.needRepublish, false);

  const appendAndPublish = planPromptTemplateVersionWrites({
    existing: [
      { version: 1, isPublished: false },
      { version: 2, isPublished: true },
    ],
    incoming: [
      { version: 1, content: 'a', createdAt: '2026-01-01T00:00:00.000Z', isPublished: false },
      { version: 2, content: 'b', createdAt: '2026-01-02T00:00:00.000Z', isPublished: false },
      { version: 3, content: 'c', createdAt: '2026-01-03T00:00:00.000Z', isPublished: true },
    ],
  });
  assert.deepEqual(
    appendAndPublish.toInsert.map((row) => row.version),
    [3]
  );
  assert.equal(appendAndPublish.needRepublish, true);
  assert.deepEqual(appendAndPublish.publishedVersions, [3]);
});
