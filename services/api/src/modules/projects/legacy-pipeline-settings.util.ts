/**
 * 已下线创作精修产品后，项目设置里仍可能持久化的 pipeline 字段读写支持。
 * 仅保留类型/默认值/preset 迁移，不含精修运行时。
 */

export type ChapterPipelinePreset = 'creative_refine' | 'full' | 'character_rules' | 'sensory_only';
export type ChapterPipelineRulesFixMode = 'auto' | 'semi' | 'manual';
export type ChapterPipelineModule = 1 | 2 | 3 | 4;

export interface ProtagonistUnlockRule {
  abilityKey: string;
  unlockAtChapter?: number;
  unlockAfterCondition?: string;
  descriptionForPrompt: string;
}

export interface ChapterPipelineConfig {
  /** @deprecated 仅用于读取存量 preset 迁移 */
  pipelinePreset?: ChapterPipelinePreset;
  pipelineSkipSensoryOutlineReview: boolean;
  pipelineSkipCharacterOutlineReview: boolean;
  pipelineSkipCharacterTraitsOutlineReview: boolean;
  pipelineCharacterAdjustmentEnabled: boolean;
  pipelineCharacterTraitsEnabled: boolean;
  pipelineHomogenizationEnabled: boolean;
  pipelineHomogenizationPriorChapterCount: number;
  pipelineEnabledModules: ChapterPipelineModule[];
}

export const DEFAULT_PIPELINE_CONFIG: ChapterPipelineConfig = {
  pipelineSkipSensoryOutlineReview: false,
  pipelineSkipCharacterOutlineReview: false,
  pipelineSkipCharacterTraitsOutlineReview: false,
  pipelineCharacterAdjustmentEnabled: false,
  pipelineCharacterTraitsEnabled: true,
  pipelineHomogenizationEnabled: false,
  pipelineHomogenizationPriorChapterCount: 3,
  pipelineEnabledModules: [1, 2],
};

export const DEFAULT_PROTAGONIST_PROGRESS_RULES: ProtagonistUnlockRule[] = [];

const PRESET_MODULES: Record<ChapterPipelinePreset, ChapterPipelineModule[]> = {
  creative_refine: [1, 2],
  full: [1, 2, 4],
  character_rules: [1],
  sensory_only: [2],
};

function resolveDefaultCharacterAdjustmentEnabled(
  preset: ChapterPipelinePreset,
  explicit?: boolean
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  return preset === 'full' || preset === 'character_rules';
}

export function migratePipelineSettingsFromPreset<
  T extends Partial<ChapterPipelineConfig> & { pipelinePreset?: ChapterPipelinePreset },
>(settings: T): Partial<ChapterPipelineConfig> & T {
  const result = { ...settings };
  const preset = settings.pipelinePreset;
  if (!result.pipelineEnabledModules?.length && preset) {
    result.pipelineEnabledModules = [...PRESET_MODULES[preset]];
  }
  if (result.pipelineCharacterAdjustmentEnabled === undefined && preset) {
    result.pipelineCharacterAdjustmentEnabled = resolveDefaultCharacterAdjustmentEnabled(preset);
  }
  if (result.pipelineHomogenizationEnabled === undefined && preset === 'full') {
    result.pipelineHomogenizationEnabled = true;
  }
  return result;
}
