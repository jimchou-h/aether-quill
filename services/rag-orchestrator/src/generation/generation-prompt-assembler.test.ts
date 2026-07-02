import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemMessage } from './generation-prompt-assembler';
import { GLOBAL_SYSTEM_DEFAULT_TEXT } from './system-prompt.util';

describe('generation-prompt-assembler omitProjectSystemPrompt', () => {
  it('omits project systemPromptText when flag is set', () => {
    const message = buildSystemMessage({
      systemPromptText: '项目专属文风不得注入',
      narrativeContext: '',
      omitProjectSystemPrompt: true,
      taskSystemPrompt: '合规任务规则',
    });
    assert.match(message, /合规任务规则/);
    assert.ok(message.includes(GLOBAL_SYSTEM_DEFAULT_TEXT.slice(0, 6)));
    assert.doesNotMatch(message, /项目专属文风不得注入/);
  });
});
