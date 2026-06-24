import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmMessages,
  buildSystemMessage,
  buildUserMessage,
} from './generation-prompt-assembler';
import { GLOBAL_SYSTEM_DEFAULT_TEXT, isLegacySingleUserPrompt } from './system-prompt.util';

describe('isLegacySingleUserPrompt', () => {
  it('defaults to false', () => {
    const prev = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
    try {
      delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      assert.equal(isLegacySingleUserPrompt(), false);
    } finally {
      if (prev === undefined) {
        delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      } else {
        process.env.LLM_PROMPT_LEGACY_SINGLE_USER = prev;
      }
    }
  });

  it('enables legacy mode when set to 1', () => {
    const prev = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
    try {
      process.env.LLM_PROMPT_LEGACY_SINGLE_USER = '1';
      assert.equal(isLegacySingleUserPrompt(), true);
    } finally {
      if (prev === undefined) {
        delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      } else {
        process.env.LLM_PROMPT_LEGACY_SINGLE_USER = prev;
      }
    }
  });
});

describe('generation prompt assembly', () => {
  const baseContext = {
    systemPromptText: '项目规则：第三人称',
    taskSystemPrompt: '任务约束：只输出优化方案',
    narrativeContext: '【大纲】主角赴京',
    retrievedEvidence: 'chunk-1 京城设定',
  };

  it('buildUserMessage excludes system instructions', () => {
    const user = buildUserMessage(baseContext, '请优化本章');
    assert.doesNotMatch(user, /【系统指令】/);
    assert.match(user, /【叙事上下文】[\s\S]*【大纲】主角赴京/);
    assert.match(user, /【检索证据】[\s\S]*chunk-1 京城设定/);
    assert.match(user, /【用户需求】\n请优化本章/);
  });

  it('buildSystemMessage merges global, project, and task layers', () => {
    const system = buildSystemMessage(baseContext);
    assert.match(system, new RegExp(GLOBAL_SYSTEM_DEFAULT_TEXT));
    assert.match(system, /项目规则：第三人称/);
    assert.match(system, /任务约束：只输出优化方案/);
  });

  it('buildLlmMessages returns system and user roles by default', () => {
    const prev = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
    try {
      delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      const messages = buildLlmMessages(baseContext, '请优化本章');
      assert.equal(messages.length, 2);
      assert.equal(messages[0]?.role, 'system');
      assert.match(messages[0]?.content ?? '', /任务约束：只输出优化方案/);
      assert.equal(messages[1]?.role, 'user');
      assert.doesNotMatch(messages[1]?.content ?? '', /【系统指令】/);
    } finally {
      if (prev === undefined) {
        delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      } else {
        process.env.LLM_PROMPT_LEGACY_SINGLE_USER = prev;
      }
    }
  });

  it('buildLlmMessages falls back to single user message in legacy mode', () => {
    const prev = process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
    try {
      process.env.LLM_PROMPT_LEGACY_SINGLE_USER = '1';
      const messages = buildLlmMessages(baseContext, '请优化本章');
      assert.equal(messages.length, 1);
      assert.equal(messages[0]?.role, 'user');
      assert.match(messages[0]?.content ?? '', /【系统指令】/);
      assert.match(messages[0]?.content ?? '', /【用户需求】\n请优化本章/);
    } finally {
      if (prev === undefined) {
        delete process.env.LLM_PROMPT_LEGACY_SINGLE_USER;
      } else {
        process.env.LLM_PROMPT_LEGACY_SINGLE_USER = prev;
      }
    }
  });
});
