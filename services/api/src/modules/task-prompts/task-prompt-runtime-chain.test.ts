import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT,
  CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY,
} from '../projects/chapter-optimize.util';
import {
  TASK_PROMPT_DEFINITIONS,
  getWarehouseDefaultTaskPromptText,
} from './task-prompt-defaults';
import { TaskPromptsService } from './task-prompts.service';

describe('task prompt warehouse defaults', () => {
  it('TASK_PROMPT_DEFINITIONS align with chapter-optimize util constants', () => {
    const byKey = Object.fromEntries(
      TASK_PROMPT_DEFINITIONS.map((item) => [item.templateKey, item.defaultText])
    );
    assert.equal(byKey[CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY], CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT);
    assert.equal(byKey[CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY], CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT);
    assert.equal(
      byKey[CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY],
      CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT
    );
    assert.equal(
      byKey[CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY],
      CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT
    );
  });
});

describe('task prompt runtime resolution chain', () => {
  function createService() {
    const projects = new Map<string, { id: string }>();
    const projectsService = {
      findOne: (projectId: string) => {
        if (!projects.has(projectId)) {
          throw new Error('not found');
        }
        return { id: projectId };
      },
    };
    return {
      service: new TaskPromptsService(projectsService as never),
      projects,
    };
  }

  it('resolveTaskSystemPrompt uses published text over warehouse default', () => {
    const { service, projects } = createService();
    const projectId = 'p-runtime-1';
    projects.set(projectId, { id: projectId });

    const custom = '项目自定义 plan prompt';
    service.saveDraft(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY, custom);
    service.publish(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY);

    assert.equal(
      service.resolveTaskSystemPrompt(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY),
      custom
    );
    assert.notEqual(
      service.resolveTaskSystemPrompt(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY),
      getWarehouseDefaultTaskPromptText(CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY)
    );
  });

  it('getEffectivePublishedTaskPromptsMap includes all whitelist keys for orchestrator sync', () => {
    const { service, projects } = createService();
    const projectId = 'p-runtime-2';
    projects.set(projectId, { id: projectId });

    const map = service.getEffectivePublishedTaskPromptsMap(projectId);
    assert.equal(Object.keys(map).length, TASK_PROMPT_DEFINITIONS.length);
    assert.match(map[CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY] ?? '', /优化方案/);
  });
});
