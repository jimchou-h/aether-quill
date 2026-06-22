import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSystemPromptSections } from './system-prompt.util';

describe('mergeSystemPromptSections', () => {
  it('joins project and task prompts', () => {
    assert.equal(
      mergeSystemPromptSections('全局风格：古风', '任务：写正文'),
      '全局风格：古风\n\n任务：写正文'
    );
  });
});
