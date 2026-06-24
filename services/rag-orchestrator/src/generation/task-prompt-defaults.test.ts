import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTaskSystemPromptFromContext,
  resolveWarehouseTaskPromptDefault,
} from './task-prompt-defaults';

describe('task-prompt-defaults', () => {
  it('resolves override with highest priority', () => {
    assert.equal(
      resolveTaskSystemPromptFromContext({
        templateKey: 'chapter.optimize.plan',
        systemPromptOverride: '临时补丁',
        taskPrompts: { 'chapter.optimize.plan': '项目已发布' },
      }),
      '临时补丁'
    );
  });

  it('falls back to synced task prompt then warehouse default', () => {
    assert.equal(
      resolveTaskSystemPromptFromContext({
        templateKey: 'chapter.optimize.plan',
        taskPrompts: { 'chapter.optimize.plan': '项目已发布' },
      }),
      '项目已发布'
    );
    assert.match(
      resolveTaskSystemPromptFromContext({
        templateKey: 'chapter.optimize.plan',
      }) ?? '',
      /优化方案/
    );
  });

  it('returns undefined for unknown template key without override', () => {
    assert.equal(
      resolveTaskSystemPromptFromContext({
        templateKey: 'unknown.task',
      }),
      undefined
    );
  });

  it('includes typo-check warehouse default', () => {
    assert.match(resolveWarehouseTaskPromptDefault('chapter.optimize.typo-check') ?? '', /JSON/);
  });
});
