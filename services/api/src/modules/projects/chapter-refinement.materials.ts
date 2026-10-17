/**
 * 章节精修冻结材料解析（AQ-381）。
 *
 * run 创建时把「运行中不应漂移」的指导与路由冻结进 snapshot：
 *  - 五个新 templateKey 的已发布文本 / 版本 / hash（D11 冻结提示）；
 *  - 项目 systemPrompt（优先已发布 system 模板，回退 settings）；
 *  - writing / utility 两档解析后的模型路由标识（只存标识，不存密钥）。
 *
 * 单独成 provider，便于服务层与单测各自注入；解析失败不阻断 run 创建，
 * 由调用方决定降级（缺文本时引擎回退仓库默认）。
 */

import { createHash } from 'node:crypto';
import {
  buildStyleSamplePromptBlock,
  resolveGenerationCallProfile,
  type UserGenerationPreferences,
  type WritingStyleSampleSceneType,
} from '@aether-quill/config';
import { AuthService } from '../auth/auth.service';
import { PromptTemplatesService } from '../prompt-templates/prompt-templates.service';
import { TaskPromptsService } from '../task-prompts/task-prompts.service';
import { ProjectsService } from './projects.service';
import {
  CHAPTER_REFINEMENT_TEMPLATE_KEYS,
  CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS,
} from './chapter-refinement.util';
import type {
  RefinementFrozenReferenceMaterials,
  RefinementModelRoute,
  RefinementReferenceMaterial,
  RefinementTemplateVersionRef,
} from './chapter-refinement.types';

export interface RefinementFrozenMaterials {
  systemPromptText: string;
  templateVersions: RefinementTemplateVersionRef[];
  templateTexts: Record<string, string>;
  modelRoutes: Record<'writing' | 'utility', RefinementModelRoute>;
  /** F4：run 创建时冻结的实际参考材料（人物 / 知识 / 文风样本） */
  referenceMaterials: RefinementFrozenReferenceMaterials;
}

export interface ChapterRefinementMaterialsProvider {
  resolve(projectId: string, userId: string, chapterNo: number): RefinementFrozenMaterials;
}

export const CHAPTER_REFINEMENT_MATERIALS = Symbol('CHAPTER_REFINEMENT_MATERIALS');

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export class DefaultChapterRefinementMaterialsProvider implements ChapterRefinementMaterialsProvider {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly taskPromptsService: TaskPromptsService,
    private readonly promptTemplatesService: PromptTemplatesService,
    private readonly authService: AuthService
  ) {}

  resolve(projectId: string, userId: string, chapterNo: number): RefinementFrozenMaterials {
    const templateTexts: Record<string, string> = {};
    const templateVersions: RefinementTemplateVersionRef[] = [];
    for (const key of CHAPTER_REFINEMENT_TEMPLATE_KEYS) {
      const detail = this.taskPromptsService.getDetail(projectId, key);
      // R1/AQ-381 冻结合同：只冻结「已发布」文本，回退到明确的发布默认版本（defaultText）。
      // 绝不把未发布 draftText 冻进 run——否则未发布的 Prompt 编辑会直接进入正式运行。
      const text = detail.publishedText?.trim() || detail.defaultText;
      templateTexts[key] = text;
      templateVersions.push({ key, version: detail.version, hash: hashText(text) });
    }

    const settings = this.projectsService.getSettings(projectId);
    let userPreferences: UserGenerationPreferences | null = null;
    try {
      userPreferences = this.authService.getGenerationPreferences(userId);
    } catch {
      userPreferences = null;
    }
    const projectOverrides = {
      generationWritingModel: settings.generationWritingModel ?? null,
      generationUtilityModel: settings.generationUtilityModel ?? null,
      generationTemperature: settings.generationTemperature,
      writingGenerationTemperature: settings.writingGenerationTemperature ?? null,
    };
    const resolveRoute = (
      templateKey: string,
      tier: 'writing' | 'utility'
    ): RefinementModelRoute => {
      const profile = resolveGenerationCallProfile({
        templateKey,
        projectOverrides,
        userPreferences,
      });
      return {
        tier,
        provider: profile.provider,
        model: profile.model,
        temperature: profile.temperature,
      };
    };

    return {
      systemPromptText: this.promptTemplatesService.resolveProjectSystemPromptText(projectId),
      templateVersions,
      templateTexts,
      modelRoutes: {
        writing: resolveRoute(
          CHAPTER_REFINEMENT_TEMPLATE_KEYS.find(
            (key) => !CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS.includes(key)
          ) ?? 'chapter.refinement.rewrite',
          'writing'
        ),
        utility: resolveRoute(CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS[0], 'utility'),
      },
      referenceMaterials: this.buildFrozenReferenceMaterials(projectId, userId, chapterNo),
    };
  }

  /**
   * F4 / C4：构建 run 冻结的实际参考材料。
   *
   * 人物卡 / 知识文档 / 文风样本在 run 创建时读取一次并冻结为文本；运行中修改这些来源不会
   * 改变本 run 的指导。文风样本已按「排除当前章来源 + 任务适用性」筛选（见
   * `projectsService.getFrozenReferenceMaterials`）。orchestrator 收到冻结材料后直接使用，
   * 不再从当前 projectCtx 检索 / 选样。
   */
  private buildFrozenReferenceMaterials(
    projectId: string,
    userId: string,
    chapterNo: number
  ): RefinementFrozenReferenceMaterials {
    let materials: RefinementReferenceMaterial[] = [];
    try {
      materials = this.projectsService.getFrozenReferenceMaterials(projectId, userId, chapterNo);
    } catch {
      materials = [];
    }
    const frozenAt = new Date().toISOString();
    const personaText = materials
      .filter((item) => item.kind === 'persona')
      .map((item) => `- ${item.title}：${item.text}`)
      .join('\n');
    const knowledgeText = materials
      .filter((item) => item.kind === 'knowledge')
      .map((item) => `-（${item.title}）${item.text}`)
      .join('\n');
    // C4：文风块用统一的样本块格式，且只含「适用且非当前章来源」的已冻结样本
    const styleSamples = materials
      .filter((item) => item.kind === 'style')
      .map((item) => ({
        id: item.id,
        text: item.text,
        sceneType: (item.sceneType ?? 'atmosphere') as WritingStyleSampleSceneType,
        ...(item.sourceChapterNo !== undefined ? { sourceChapterNo: item.sourceChapterNo } : {}),
        createdAt: frozenAt,
        updatedAt: frozenAt,
      }));
    const styleSampleBlock = buildStyleSamplePromptBlock(styleSamples);
    const promptText = materials.map((item) => `${item.title}\n${item.text}`).join('\n\n');
    return {
      materials,
      promptText,
      personaText,
      knowledgeText,
      styleSampleBlock,
      frozenAt,
    };
  }
}
