import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonaSnapshotSection } from './persona-snapshot';

test('buildPersonaSnapshotSection formats clothing and status', () => {
  const result = buildPersonaSnapshotSection({
    currentChapterNo: 3,
    personas: [
      {
        name: '李四',
        profile: '律师',
        state: '待更新',
        status: 'published',
        chapterStates: [
          {
            chapterNo: 2,
            appeared: true,
            snapshot: { clothing: '黑色西装', status: '紧张' },
            summaryLine: '着装：黑色西装；状态：紧张',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      },
    ],
  });

  assert.ok(result.text.includes('【人物当前快照】'));
  assert.ok(result.text.includes('黑色西装'));
  assert.ok(result.text.includes('紧张'));
  assert.equal(result.injectedCount, 1);
  assert.equal(result.asOfChapterNo, 2);
});
