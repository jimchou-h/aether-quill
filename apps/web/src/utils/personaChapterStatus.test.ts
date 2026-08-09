import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePersonaStatusForView } from './personaChapterStatus';

const basePersona = {
  state: '最新状态：已突破金丹',
  chapterStates: [
    {
      chapterNo: 2,
      appeared: true,
      snapshot: {},
      summaryLine: '第2章后：筑基初期',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      chapterNo: 5,
      appeared: true,
      snapshot: {},
      summaryLine: '第5章后：筑基圆满',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
};

test('latest mode uses persona.state', () => {
  const result = resolvePersonaStatusForView(basePersona, 'latest');
  assert.equal(result.text, '最新状态：已突破金丹');
  assert.equal(result.sourceChapterNo, null);
});

test('as-of chapter picks latest chapterStates with chapterNo <= N', () => {
  const at3 = resolvePersonaStatusForView(basePersona, { asOfChapterNo: 3 });
  assert.equal(at3.text, '第2章后：筑基初期');
  assert.equal(at3.sourceChapterNo, 2);

  const at5 = resolvePersonaStatusForView(basePersona, { asOfChapterNo: 5 });
  assert.equal(at5.text, '第5章后：筑基圆满');
  assert.equal(at5.sourceChapterNo, 5);
});

test('empty chapterStates falls back to persona.state', () => {
  const result = resolvePersonaStatusForView({ state: '手工状态', chapterStates: [] }, {
    asOfChapterNo: 4,
  });
  assert.equal(result.text, '手工状态');
  assert.equal(result.sourceChapterNo, null);
});
