import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertConfirmedOutlineText,
  buildWorkbenchDraftUserPrompt,
} from './write-chapter-prompt';

describe('write-chapter-prompt', () => {
  it('requires confirmedOutlineText', () => {
    assert.throws(() => assertConfirmedOutlineText(''), /confirmedOutlineText/);
  });

  it('buildWorkbenchDraftUserPrompt wraps chapter-outline', () => {
    const prompt = buildWorkbenchDraftUserPrompt(
      { chapterNo: 1, goal: '开篇', pov: '第一人称', mustInclude: [], avoid: [] },
      '节拍一\n节拍二'
    );
    assert.match(prompt, /<chapter-outline>[\s\S]*节拍一[\s\S]*<\/chapter-outline>/);
  });
});
