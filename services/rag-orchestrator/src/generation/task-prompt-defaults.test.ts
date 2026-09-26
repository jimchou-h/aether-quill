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
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.optimize.draft') ?? '',
      /实质性重写/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.compliance.outline') ?? '',
      /动作合理性、空间合理性/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.compliance.outline') ?? '',
      /情色、性爱、身体描写本身不是违规/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.compliance.outline') ?? '',
      /需完整匹配，比如「子宫」为非禁用词/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.compliance.outline') ?? '',
      /不得标「未记载」/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.compliance.rewrite') ?? '',
      /先后动作保持原文顺序/
    );
    assert.doesNotMatch(
      resolveWarehouseTaskPromptDefault('chapter.compliance.outline') ?? '',
      /擦边表述/
    );
    assert.doesNotMatch(
      resolveWarehouseTaskPromptDefault('chapter.optimize.draft') ?? '',
      /不是待勾选的句级清单/
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

  it('includes workbench warehouse defaults', () => {
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.optimize.workbench-draft-sex') ?? '',
      /<range-original>/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.optimize.workbench-draft-prose') ?? '',
      /禁止按性爱加料要求/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.optimize.workbench-review') ?? '',
      /\{"items":\[\]\}/
    );
    assert.match(
      resolveWarehouseTaskPromptDefault('chapter.optimize.workbench-fix-span') ?? '',
      /<span-original>/
    );
  });
});
