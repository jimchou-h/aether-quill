import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBAL_SYSTEM_DEFAULT_TEXT,
  assembleSystemMessageContent,
  mergeSystemPromptSections,
} from './system-prompt.util';

describe('mergeSystemPromptSections', () => {
  it('joins project and task prompts', () => {
    assert.equal(
      mergeSystemPromptSections('全局风格：古风', '任务：写正文'),
      '全局风格：古风\n\n任务：写正文'
    );
  });
});

describe('assembleSystemMessageContent', () => {
  it('prepends global default before project and task text', () => {
    assert.equal(
      assembleSystemMessageContent({
        systemPromptText: '项目文风',
        taskSystemPrompt: '任务规则',
      }),
      `${GLOBAL_SYSTEM_DEFAULT_TEXT}\n\n项目文风\n\n任务规则`
    );
  });
});
