import type { ProjectContentSafetyRule } from '@aether-quill/config';
import { sanitizeProjectContentSafetyRules } from '@aether-quill/config';
import type { PersistedProjectState } from './persisted-workspace.types';
import {
  clampChapterOptimizeSegmentCharSize,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
} from './chapter-optimize.util';
import type { ChapterPipelineConfig, ProtagonistUnlockRule } from './chapter-pipeline.util';
import { DEFAULT_PIPELINE_CONFIG, DEFAULT_PROTAGONIST_PROGRESS_RULES } from './chapter-pipeline.util';
import {
  clampContextExcerptMaxChars,
  clampPriorChapterTailChars,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
} from './project-settings.util';

/** PG `project_settings.settings_extensions` 与 JSON 迁移脚本共用的扩展字段 */
export type ProjectSettingsJsonExtensions = {
  priorChapterTailChars?: number;
  contextExcerptMaxChars?: number;
  updatePersonaOnSave?: boolean;
  generateRelationEventsOnSave?: boolean;
  chapterOptimizeSegmentCharSize?: number;
  contentSafetyScanEnabled?: boolean;
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
  pipelinePreset?: ChapterPipelineConfig['pipelinePreset'];
  pipelineSkipSensoryOutlineReview?: boolean;
  pipelineSkipCharacterOutlineReview?: boolean;
  pipelineSkipCharacterTraitsOutlineReview?: boolean;
  pipelineCharacterAdjustmentEnabled?: boolean;
  pipelineCharacterTraitsEnabled?: boolean;
  pipelineRulesFixMode?: ChapterPipelineConfig['pipelineRulesFixMode'];
  pipelineRulesModuleEnabled?: boolean;
  complianceRulesFixMode?: ChapterPipelineConfig['pipelineRulesFixMode'];
  pipelineHomogenizationEnabled?: boolean;
  pipelineHomogenizationPriorChapterCount?: number;
  pipelineEnabledModules?: number[];
  protagonistProgressRules?: ProtagonistUnlockRule[];
};

export function pickProjectSettingsJsonExtensions(
  raw: ProjectSettingsJsonExtensions | undefined
): ProjectSettingsJsonExtensions {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return {
    priorChapterTailChars: raw.priorChapterTailChars,
    contextExcerptMaxChars: raw.contextExcerptMaxChars,
    updatePersonaOnSave: raw.updatePersonaOnSave,
    generateRelationEventsOnSave: raw.generateRelationEventsOnSave,
    chapterOptimizeSegmentCharSize: raw.chapterOptimizeSegmentCharSize,
    contentSafetyScanEnabled: raw.contentSafetyScanEnabled,
    ...(Array.isArray(raw.contentSafetyCustomRules)
      ? { contentSafetyCustomRules: raw.contentSafetyCustomRules }
      : {}),
    pipelinePreset: raw.pipelinePreset,
    pipelineSkipSensoryOutlineReview: raw.pipelineSkipSensoryOutlineReview,
    pipelineSkipCharacterOutlineReview: raw.pipelineSkipCharacterOutlineReview,
    pipelineSkipCharacterTraitsOutlineReview: raw.pipelineSkipCharacterTraitsOutlineReview,
    pipelineCharacterAdjustmentEnabled: raw.pipelineCharacterAdjustmentEnabled,
    pipelineCharacterTraitsEnabled: raw.pipelineCharacterTraitsEnabled,
    pipelineRulesFixMode: raw.pipelineRulesFixMode,
    pipelineRulesModuleEnabled: raw.pipelineRulesModuleEnabled,
    complianceRulesFixMode: raw.complianceRulesFixMode,
    pipelineHomogenizationEnabled: raw.pipelineHomogenizationEnabled,
    pipelineHomogenizationPriorChapterCount: raw.pipelineHomogenizationPriorChapterCount,
    pipelineEnabledModules: raw.pipelineEnabledModules,
    protagonistProgressRules: raw.protagonistProgressRules,
  };
}

export function applyProjectSettingsJsonExtensions<T extends ProjectSettingsJsonExtensions>(
  target: T,
  extensions: ProjectSettingsJsonExtensions
): void {
  if (extensions.priorChapterTailChars !== undefined) {
    target.priorChapterTailChars = clampPriorChapterTailChars(extensions.priorChapterTailChars);
  }
  if (extensions.contextExcerptMaxChars !== undefined) {
    target.contextExcerptMaxChars = clampContextExcerptMaxChars(extensions.contextExcerptMaxChars);
  }
  if (extensions.updatePersonaOnSave !== undefined) {
    target.updatePersonaOnSave = extensions.updatePersonaOnSave;
  }
  if (extensions.generateRelationEventsOnSave !== undefined) {
    target.generateRelationEventsOnSave = extensions.generateRelationEventsOnSave;
  }
  if (extensions.chapterOptimizeSegmentCharSize !== undefined) {
    target.chapterOptimizeSegmentCharSize = clampChapterOptimizeSegmentCharSize(
      extensions.chapterOptimizeSegmentCharSize
    );
  }
  if (extensions.contentSafetyScanEnabled !== undefined) {
    target.contentSafetyScanEnabled = extensions.contentSafetyScanEnabled;
  }
  if (Array.isArray(extensions.contentSafetyCustomRules)) {
    target.contentSafetyCustomRules = sanitizeProjectContentSafetyRules(
      extensions.contentSafetyCustomRules
    );
  }
  if (extensions.pipelinePreset !== undefined) {
    target.pipelinePreset = extensions.pipelinePreset;
  }
  if (extensions.pipelineSkipSensoryOutlineReview !== undefined) {
    target.pipelineSkipSensoryOutlineReview = extensions.pipelineSkipSensoryOutlineReview;
  }
  if (extensions.pipelineSkipCharacterOutlineReview !== undefined) {
    target.pipelineSkipCharacterOutlineReview = extensions.pipelineSkipCharacterOutlineReview;
  }
  if (extensions.pipelineSkipCharacterTraitsOutlineReview !== undefined) {
    target.pipelineSkipCharacterTraitsOutlineReview =
      extensions.pipelineSkipCharacterTraitsOutlineReview;
  }
  if (extensions.pipelineCharacterTraitsEnabled !== undefined) {
    target.pipelineCharacterTraitsEnabled = extensions.pipelineCharacterTraitsEnabled;
  }
  if (extensions.pipelineCharacterAdjustmentEnabled !== undefined) {
    target.pipelineCharacterAdjustmentEnabled = extensions.pipelineCharacterAdjustmentEnabled;
  }
  if (extensions.pipelineRulesFixMode !== undefined) {
    target.pipelineRulesFixMode = extensions.pipelineRulesFixMode;
  }
  if (extensions.pipelineRulesModuleEnabled !== undefined) {
    target.pipelineRulesModuleEnabled = extensions.pipelineRulesModuleEnabled;
  }
  if (extensions.complianceRulesFixMode !== undefined) {
    target.complianceRulesFixMode = extensions.complianceRulesFixMode;
  }
  if (extensions.pipelineHomogenizationEnabled !== undefined) {
    target.pipelineHomogenizationEnabled = extensions.pipelineHomogenizationEnabled;
  }
  if (extensions.pipelineHomogenizationPriorChapterCount !== undefined) {
    target.pipelineHomogenizationPriorChapterCount = Math.min(
      10,
      Math.max(1, extensions.pipelineHomogenizationPriorChapterCount)
    );
  }
  if (Array.isArray(extensions.pipelineEnabledModules)) {
    target.pipelineEnabledModules = extensions.pipelineEnabledModules.filter(
      (m) => m >= 1 && m <= 4
    );
  }
  if (Array.isArray(extensions.protagonistProgressRules)) {
    target.protagonistProgressRules = extensions.protagonistProgressRules;
  }
}

export function mergeProjectSettingsFromJsonMirror(
  settingsByProject: Record<string, ProjectSettingsJsonExtensions>,
  jsonMirror: PersistedProjectState | null | undefined
): void {
  if (!jsonMirror?.settings) {
    return;
  }
  for (const [projectId, runtimeSettings] of Object.entries(settingsByProject)) {
    const jsonSettings = jsonMirror.settings[projectId];
    if (!jsonSettings) {
      continue;
    }
    applyProjectSettingsJsonExtensions(
      runtimeSettings,
      pickProjectSettingsJsonExtensions(jsonSettings)
    );
  }
}

type PersistedProjectSettingsRow = PersistedProjectState['settings'][string];

/** 将运行时 settings 序列化为 JSON 镜像条目（扩展字段始终显式落盘） */
export function serializeProjectSettingsForJsonMirror(settings: {
  systemPromptText: string;
  activePersonaId: string | null;
  chapterSummaryPromptCount: number;
  chapterSummaryMemoryCount: number;
  priorChapterTailChars?: number;
  contextExcerptMaxChars?: number;
  generationTemperature: number;
  updatePersonaOnSave?: boolean;
  generateRelationEventsOnSave?: boolean;
  chapterOptimizeSegmentCharSize?: number;
  contentSafetyScanEnabled?: boolean;
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
  pipelinePreset?: ChapterPipelineConfig['pipelinePreset'];
  pipelineSkipSensoryOutlineReview?: boolean;
  pipelineSkipCharacterOutlineReview?: boolean;
  pipelineSkipCharacterTraitsOutlineReview?: boolean;
  pipelineCharacterAdjustmentEnabled?: boolean;
  pipelineCharacterTraitsEnabled?: boolean;
  pipelineRulesFixMode?: ChapterPipelineConfig['pipelineRulesFixMode'];
  pipelineRulesModuleEnabled?: boolean;
  complianceRulesFixMode?: ChapterPipelineConfig['pipelineRulesFixMode'];
  pipelineHomogenizationEnabled?: boolean;
  pipelineHomogenizationPriorChapterCount?: number;
  pipelineEnabledModules?: number[];
  protagonistProgressRules?: ProtagonistUnlockRule[];
  updatedAt: Date;
}): PersistedProjectSettingsRow {
  return {
    systemPromptText: settings.systemPromptText,
    activePersonaId: settings.activePersonaId,
    chapterSummaryPromptCount: settings.chapterSummaryPromptCount,
    chapterSummaryMemoryCount: settings.chapterSummaryMemoryCount,
    priorChapterTailChars: clampPriorChapterTailChars(
      settings.priorChapterTailChars ?? DEFAULT_PRIOR_CHAPTER_TAIL_CHARS
    ),
    contextExcerptMaxChars: clampContextExcerptMaxChars(
      settings.contextExcerptMaxChars ?? DEFAULT_CONTEXT_EXCERPT_MAX_CHARS
    ),
    generationTemperature: settings.generationTemperature,
    updatePersonaOnSave: settings.updatePersonaOnSave ?? true,
    generateRelationEventsOnSave: settings.generateRelationEventsOnSave ?? true,
    chapterOptimizeSegmentCharSize: clampChapterOptimizeSegmentCharSize(
      settings.chapterOptimizeSegmentCharSize ?? DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE
    ),
    contentSafetyScanEnabled: settings.contentSafetyScanEnabled ?? true,
    contentSafetyCustomRules: sanitizeProjectContentSafetyRules(
      settings.contentSafetyCustomRules
    ).map((rule) => ({ ...rule })),
    pipelinePreset: settings.pipelinePreset ?? DEFAULT_PIPELINE_CONFIG.pipelinePreset,
    pipelineSkipSensoryOutlineReview:
      settings.pipelineSkipSensoryOutlineReview ??
      DEFAULT_PIPELINE_CONFIG.pipelineSkipSensoryOutlineReview,
    pipelineSkipCharacterOutlineReview:
      settings.pipelineSkipCharacterOutlineReview ??
      DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterOutlineReview,
    pipelineSkipCharacterTraitsOutlineReview:
      settings.pipelineSkipCharacterTraitsOutlineReview ??
      DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterTraitsOutlineReview,
    pipelineCharacterAdjustmentEnabled:
      settings.pipelineCharacterAdjustmentEnabled ??
      DEFAULT_PIPELINE_CONFIG.pipelineCharacterAdjustmentEnabled,
    pipelineCharacterTraitsEnabled:
      settings.pipelineCharacterTraitsEnabled ?? DEFAULT_PIPELINE_CONFIG.pipelineCharacterTraitsEnabled,
    pipelineRulesFixMode:
      settings.pipelineRulesFixMode ?? DEFAULT_PIPELINE_CONFIG.pipelineRulesFixMode,
    pipelineHomogenizationEnabled:
      settings.pipelineHomogenizationEnabled ??
      DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationEnabled,
    pipelineHomogenizationPriorChapterCount:
      settings.pipelineHomogenizationPriorChapterCount ??
      DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationPriorChapterCount,
    pipelineEnabledModules:
      settings.pipelineEnabledModules ?? DEFAULT_PIPELINE_CONFIG.pipelineEnabledModules,
    protagonistProgressRules:
      settings.protagonistProgressRules ?? DEFAULT_PROTAGONIST_PROGRESS_RULES,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export const PROJECT_SETTINGS_JSON_EXTENSION_DEFAULTS = {
  priorChapterTailChars: DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  contextExcerptMaxChars: DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  updatePersonaOnSave: true,
  generateRelationEventsOnSave: true,
  chapterOptimizeSegmentCharSize: DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  contentSafetyScanEnabled: true,
  contentSafetyCustomRules: [] as ProjectContentSafetyRule[],
  pipelinePreset: DEFAULT_PIPELINE_CONFIG.pipelinePreset,
  pipelineSkipSensoryOutlineReview: DEFAULT_PIPELINE_CONFIG.pipelineSkipSensoryOutlineReview,
  pipelineSkipCharacterOutlineReview: DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterOutlineReview,
  pipelineSkipCharacterTraitsOutlineReview:
    DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterTraitsOutlineReview,
  pipelineCharacterAdjustmentEnabled: DEFAULT_PIPELINE_CONFIG.pipelineCharacterAdjustmentEnabled,
  pipelineCharacterTraitsEnabled: DEFAULT_PIPELINE_CONFIG.pipelineCharacterTraitsEnabled,
  pipelineRulesFixMode: DEFAULT_PIPELINE_CONFIG.pipelineRulesFixMode,
  pipelineHomogenizationEnabled: DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationEnabled,
  pipelineHomogenizationPriorChapterCount:
    DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationPriorChapterCount,
  pipelineEnabledModules: DEFAULT_PIPELINE_CONFIG.pipelineEnabledModules,
  protagonistProgressRules: DEFAULT_PROTAGONIST_PROGRESS_RULES,
};
