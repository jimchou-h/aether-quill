import assert from 'node:assert/strict';
import test from 'node:test';
import { DefaultChapterRefinementMaterialsProvider } from './chapter-refinement.materials';
import {
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_TEMPLATE_KEYS,
} from './chapter-refinement.util';
import type { AuthService } from '../auth/auth.service';
import type { PromptTemplatesService } from '../prompt-templates/prompt-templates.service';
import type { TaskPromptsService } from '../task-prompts/task-prompts.service';
import type { ProjectsService } from './projects.service';

interface StubOptions {
  details?: Record<
    string,
    { publishedText: string; draftText: string; defaultText: string; version: number }
  >;
  systemPromptText?: string;
  settings?: Record<string, unknown>;
  userPreferences?: unknown;
}

function createProvider(options: StubOptions = {}) {
  const details = options.details ?? {};
  const taskPrompts = {
    getDetail(_projectId: string, templateKey: string) {
      return (
        details[templateKey] ?? {
          publishedText: '',
          draftText: '',
          defaultText: `默认-${templateKey}`,
          version: 1,
        }
      );
    },
  } as unknown as TaskPromptsService;

  const promptTemplates = {
    resolveProjectSystemPromptText() {
      return options.systemPromptText ?? '项目系统提示（冻结）';
    },
  } as unknown as PromptTemplatesService;

  const projects = {
    getSettings() {
      return options.settings ?? {};
    },
  } as unknown as ProjectsService;

  const auth = {
    getGenerationPreferences() {
      if (options.userPreferences === undefined) {
        throw new Error('no preferences');
      }
      return options.userPreferences;
    },
  } as unknown as AuthService;

  return new DefaultChapterRefinementMaterialsProvider(
    projects,
    taskPrompts,
    promptTemplates,
    auth
  );
}

test('模板文本只冻结已发布文本；无发布文本时回退发布默认，绝不使用草稿', () => {
  const provider = createProvider({
    details: {
      [CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY]: {
        publishedText: '已发布诊断',
        draftText: '草稿诊断',
        defaultText: '默认诊断',
        version: 3,
      },
      [CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY]: {
        publishedText: '',
        draftText: '草稿规划',
        defaultText: '默认规划',
        version: 2,
      },
    },
  });

  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(materials.templateTexts[CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY], '已发布诊断');
  // 未发布：用发布默认，而不是未发布草稿
  assert.equal(materials.templateTexts[CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY], '默认规划');
  assert.notEqual(materials.templateTexts[CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY], '草稿规划');
  assert.equal(
    materials.templateTexts[CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY],
    `默认-${CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY}`
  );
  assert.equal(materials.templateVersions.length, CHAPTER_REFINEMENT_TEMPLATE_KEYS.length);
  const inspectVersion = materials.templateVersions.find(
    (item) => item.key === CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY
  );
  assert.equal(inspectVersion?.version, 3);
  assert.equal(inspectVersion?.hash.length, 16);
  assert.equal(materials.systemPromptText, '项目系统提示（冻结）');
});

test('W3：有草稿、无已发布文本时冻结的是发布默认，草稿不进入运行材料', () => {
  const provider = createProvider({
    details: {
      [CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY]: {
        publishedText: '',
        draftText: '作者未发布的改写草稿',
        defaultText: '官方默认改写指导',
        version: 5,
      },
    },
  });

  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(
    materials.templateTexts[CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY],
    '官方默认改写指导'
  );
  assert.equal(
    Object.values(materials.templateTexts).includes('作者未发布的改写草稿'),
    false,
    '未发布草稿不得出现在任何冻结文本中'
  );
});

test('模型路由按档位解析：writing 用于改写，utility 用于诊断/规划/检查', () => {
  const provider = createProvider();
  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(materials.modelRoutes.writing.tier, 'writing');
  assert.equal(materials.modelRoutes.utility.tier, 'utility');
  assert.equal(materials.modelRoutes.writing.model.length > 0, true);
  assert.equal(materials.modelRoutes.utility.model.length > 0, true);
});

test('项目级 writing 模型覆盖在无用户偏好时生效', () => {
  const provider = createProvider({
    settings: { generationWritingModel: 'project-writing-model' },
  });
  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(materials.modelRoutes.writing.model, 'project-writing-model');
});

test('用户偏好存在时优先于项目覆盖，且不抛出', () => {
  const provider = createProvider({
    settings: { generationWritingModel: 'project-writing-model' },
    userPreferences: {
      writing: { provider: 'deepseek', model: 'user-writing-model', temperature: 0.5 },
      utility: { provider: 'deepseek', model: 'user-utility-model', temperature: 0.3 },
    },
  });

  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(materials.modelRoutes.writing.model, 'user-writing-model');
  assert.equal(materials.modelRoutes.utility.model, 'user-utility-model');
});

test('repair 模板 key 也纳入冻结文本（当前只注册，任务 4 接入）', () => {
  const provider = createProvider();
  const materials = provider.resolve('p1', 'u1', 1);

  assert.equal(typeof materials.templateTexts[CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY], 'string');
  assert.equal(
    materials.templateVersions.some((item) => item.key === CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY),
    true
  );
});

test('review / rewrite 模板 key 均被冻结，避免运行时 Settings 漂移', () => {
  const provider = createProvider();
  const materials = provider.resolve('p1', 'u1', 1);

  for (const key of [
    CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
    CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  ]) {
    assert.equal(typeof materials.templateTexts[key], 'string');
  }
});
