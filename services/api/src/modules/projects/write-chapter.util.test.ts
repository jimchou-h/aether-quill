import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertConfirmedOutlineForDraft,
  assertOutlineText,
  buildWriteDraftUserPrompt,
  buildWriteOutlineUserPrompt,
  makeWriteOutlineId,
} from './write-chapter.util';

const baseTask = {
  chapterNo: 3,
  goal: '揭示师父身份',
  pov: '第三人称',
  mustInclude: ['雨夜'],
  avoid: ['血腥'],
  targetWords: 3000,
  appearingCharacters: ['林默'],
};

describe('write-chapter.util', () => {
  it('buildWriteOutlineUserPrompt includes writing-task and relation events', () => {
    const prompt = buildWriteOutlineUserPrompt({
      task: baseTask,
      selectedRelationEvents: [
        {
          id: 'e1',
          protagonist: '林默',
          counterparty: '师父',
          summary: '师徒决裂',
          chapterNo: 2,
        },
      ],
    });
    assert.match(prompt, /<writing-task>/);
    assert.match(prompt, /揭示师父身份/);
    assert.match(prompt, /林默 ↔ 师父/);
    assert.match(prompt, /章节大纲/);
  });

  it('buildWriteDraftUserPrompt injects chapter-outline', () => {
    const prompt = buildWriteDraftUserPrompt({
      task: baseTask,
      confirmedOutlineText: '场景一：雨夜对峙\n场景二：真相揭晓',
    });
    assert.match(prompt, /<chapter-outline>[\s\S]*场景一：雨夜对峙[\s\S]*<\/chapter-outline>/);
    assert.match(prompt, /严格按/);
  });

  it('assertOutlineText rejects empty', () => {
    assert.throws(() => assertOutlineText(''), /outlineText/);
  });

  it('assertConfirmedOutlineForDraft rejects missing', () => {
    assert.throws(() => assertConfirmedOutlineForDraft(''), /confirmedOutlineText/);
  });

  it('makeWriteOutlineId has woutline prefix', () => {
    const id = makeWriteOutlineId();
    assert.match(id, /^woutline-/);
  });
});
