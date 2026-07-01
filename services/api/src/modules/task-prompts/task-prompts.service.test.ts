import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { TaskPromptsService } from './task-prompts.service';
import { CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY } from '../projects/chapter-optimize.util';
import { TASK_PROMPT_DEFINITIONS } from './task-prompt-defaults';

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
  const service = new TaskPromptsService(projectsService as never);
  return { service, projects };
}

describe('TaskPromptsService', () => {
  let service: TaskPromptsService;
  let projects: Map<string, { id: string }>;

  beforeEach(() => {
    const ctx = createService();
    service = ctx.service;
    projects = ctx.projects;
  });

  function registerProject(projectId: string) {
    projects.set(projectId, { id: projectId });
    return projectId;
  }

  it('lists warehouse defaults for all whitelist keys', () => {
    const projectId = registerProject('project-test-list');
    const list = service.listByProject(projectId);
    assert.equal(list.length, TASK_PROMPT_DEFINITIONS.length);
    assert.ok(list.some((item) => item.templateKey === CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY));
    assert.match(list[0]?.defaultText ?? '', /小说/);
  });

  it('resolveTaskSystemPrompt returns warehouse default when unpublished', () => {
    const projectId = registerProject('project-test-default');
    const text = service.resolveTaskSystemPrompt(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY);
    assert.match(text, /优化方案/);
  });

  it('publish applies draft and resolve uses published text', () => {
    const projectId = registerProject('project-test-publish');
    const custom = '自定义 plan system prompt';
    service.saveDraft(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY, custom);
    service.publish(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY);
    assert.equal(
      service.resolveTaskSystemPrompt(projectId, CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY),
      custom
    );
  });

  it('rejects unsupported template key', () => {
    const projectId = registerProject('project-test-invalid');
    assert.throws(
      () => service.saveDraft(projectId, 'write.chapter', 'x'),
      (error: unknown) => error instanceof BadRequestException
    );
  });
});
