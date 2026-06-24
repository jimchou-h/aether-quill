import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmMessages } from './generation-prompt-assembler';
import { resolveTaskSystemPromptFromContext } from './task-prompt-defaults';
import { CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY } from '../retrieval/knowledge-retrieval';

describe('task prompt orchestrator runtime chain', () => {
  it('resolveTaskSystemPromptFromContext feeds buildLlmMessages system role', () => {
    const projectTaskPrompt = '项目已发布 plan system';
    const taskSystem = resolveTaskSystemPromptFromContext({
      templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
      taskPrompts: {
        [CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY]: projectTaskPrompt,
      },
    });

    const messages = buildLlmMessages(
      {
        systemPromptText: '项目文风：克制',
        taskSystemPrompt: taskSystem,
        narrativeContext: '【大纲】测试',
      },
      '请输出优化方案'
    );

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'system');
    assert.match(messages[0]?.content ?? '', /项目已发布 plan system/);
    assert.match(messages[0]?.content ?? '', /项目文风：克制/);
    assert.equal(messages[1]?.role, 'user');
    assert.doesNotMatch(messages[1]?.content ?? '', /【系统指令】/);
    assert.match(messages[1]?.content ?? '', /【用户需求】\n请输出优化方案/);
  });

  it('systemPromptOverride wins over synced taskPrompts', () => {
    const resolved = resolveTaskSystemPromptFromContext({
      templateKey: CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
      systemPromptOverride: '内部临时补丁',
      taskPrompts: {
        [CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY]: '项目已发布',
      },
    });
    assert.equal(resolved, '内部临时补丁');
  });
});
