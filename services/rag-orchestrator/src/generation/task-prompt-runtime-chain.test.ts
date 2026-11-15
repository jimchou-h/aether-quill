import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmMessages } from './generation-prompt-assembler';
import { resolveTaskSystemPromptFromContext } from './task-prompt-defaults';
import {
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  readProjectSystemPromptOverride,
} from '../retrieval/knowledge-retrieval';

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
    assert.match(messages[1]?.content ?? '', /【任务输入】\n请输出优化方案/);
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

  it('editor chat keeps the project prompt once and places advice instructions after it', () => {
    const projectText = '项目写作规则：只输出正文';
    const taskText = '编辑对话规则：只给有原文依据的建议';
    const projectSystem = readProjectSystemPromptOverride({
      projectSystemPromptOverride: projectText,
    });
    const taskSystem = resolveTaskSystemPromptFromContext({
      templateKey: 'editor_chat',
      systemPromptOverride: taskText,
    });
    const messages = buildLlmMessages(
      {
        systemPromptText: projectSystem ?? '',
        taskSystemPrompt: taskSystem,
        narrativeContext: '',
      },
      '第 7 章有哪些需要优化的地方？'
    );
    const system = messages[0]?.content ?? '';
    assert.equal(system.split(projectText).length - 1, 1);
    assert.equal(system.split(taskText).length - 1, 1);
    assert.ok(system.indexOf(projectText) < system.indexOf(taskText));
    assert.equal(messages[1]?.role, 'user');
  });
});
