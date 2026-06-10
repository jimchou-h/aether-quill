import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersonaSnapshotsForPrompt,
  buildSummaryLineFromSnapshot,
  resolvePersonaSnapshotAsOfChapter,
  upsertPersonaChapterState,
} from './persona-snapshot.util';

test('buildSummaryLineFromSnapshot includes clothing and status', () => {
  const line = buildSummaryLineFromSnapshot({
    clothing: '深灰西装',
    status: '轻微醉酒',
    location: '酒店大堂',
  });
  assert.ok(line.includes('着装：深灰西装'));
  assert.ok(line.includes('状态：轻微醉酒'));
  assert.ok(line.includes('位置：酒店大堂'));
});

test('resolvePersonaSnapshotAsOfChapter picks latest before chapter', () => {
  const states = [
    {
      chapterNo: 1,
      appeared: true,
      snapshot: { clothing: '便装' },
      summaryLine: '着装：便装',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      chapterNo: 2,
      appeared: true,
      snapshot: { clothing: '深灰西装' },
      summaryLine: '着装：深灰西装',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ];
  const resolved = resolvePersonaSnapshotAsOfChapter(states, 3);
  assert.equal(resolved?.chapterNo, 2);
  assert.equal(resolved?.snapshot.clothing, '深灰西装');
});

test('upsertPersonaChapterState replaces same chapter', () => {
  const first = upsertPersonaChapterState(undefined, {
    chapterNo: 2,
    appeared: true,
    snapshot: { clothing: '旧' },
    summaryLine: '着装：旧',
  });
  const second = upsertPersonaChapterState(first, {
    chapterNo: 2,
    appeared: true,
    snapshot: { clothing: '新西装', status: '冷静' },
    summaryLine: '着装：新西装；状态：冷静',
  });
  assert.equal(second.length, 1);
  assert.equal(second[0]?.snapshot.clothing, '新西装');
});

test('buildPersonaSnapshotsForPrompt uses as-of chapter snapshots', () => {
  const lines = buildPersonaSnapshotsForPrompt({
    currentChapterNo: 3,
    personas: [
      {
        name: '张三',
        state: '待更新',
        status: 'published',
        chapterStates: [
          {
            chapterNo: 2,
            appeared: true,
            snapshot: { clothing: '深灰西装', status: '冷静' },
            summaryLine: '着装：深灰西装；状态：冷静',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      },
    ],
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.line.includes('深灰西装'));
  assert.ok(lines[0]?.line.includes('截至第2章'));
});
