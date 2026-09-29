import type { ProjectContentSafetyRule } from '@aether-quill/config';
import { sanitizeProjectContentSafetyRules } from '@aether-quill/config';
import type { PersistedProjectState } from './persisted-workspace.types';
import {
  clampChapterOptimizeSegmentCharSize,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
} from './chapter-optimize.util';
import type { WritingStyleSample } from './writing-style-samples.util';
import { sanitizeWritingStyleSamples } from './writing-style-samples.util';
import {
  clampContextExcerptMaxChars,
  clampOutlineMaxChars,
  clampPersonaProfileMaxChars,
  clampPriorChapterTailChars,
  clampRelationMemoMaxChars,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_OUTLINE_MAX_CHARS,
  DEFAULT_PERSONA_PROFILE_MAX_CHARS,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  DEFAULT_RELATION_MEMO_MAX_CHARS,
} from './project-settings.util';
import {
  normalizeGenerationModelId,
  resolveWritingGenerationTemperatureOverride,
} from '@aether-quill/config';

/** PG `project_settings.settings_extensions` 与 JSON 迁移脚本共用的扩展字段 */
export type ProjectSettingsJsonExtensions = {
  priorChapterTailChars?: number;
  contextExcerptMaxChars?: number;
  outlineMaxChars?: number;
  personaProfileMaxChars?: number;
  relationMemoMaxChars?: number;
  updatePersonaOnSave?: boolean;
  generateRelationEventsOnSave?: boolean;
  chapterOptimizeSegmentCharSize?: number;
  contentSafetyScanEnabled?: boolean;
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
  writingStyleSamples?: WritingStyleSample[];
  generationWritingModel?: string | null;
  generationUtilityModel?: string | null;
  writingGenerationTemperature?: number | null;
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
    outlineMaxChars: raw.outlineMaxChars,
    personaProfileMaxChars: raw.personaProfileMaxChars,
    relationMemoMaxChars: raw.relationMemoMaxChars,
    updatePersonaOnSave: raw.updatePersonaOnSave,
    generateRelationEventsOnSave: raw.generateRelationEventsOnSave,
    chapterOptimizeSegmentCharSize: raw.chapterOptimizeSegmentCharSize,
    contentSafetyScanEnabled: raw.contentSafetyScanEnabled,
    ...(Array.isArray(raw.contentSafetyCustomRules)
      ? { contentSafetyCustomRules: raw.contentSafetyCustomRules }
      : {}),
    ...(Array.isArray(raw.writingStyleSamples)
      ? { writingStyleSamples: raw.writingStyleSamples }
      : {}),
    ...(raw.generationWritingModel !== undefined
      ? { generationWritingModel: raw.generationWritingModel }
      : {}),
    ...(raw.generationUtilityModel !== undefined
      ? { generationUtilityModel: raw.generationUtilityModel }
      : {}),
    ...(raw.writingGenerationTemperature !== undefined
      ? { writingGenerationTemperature: raw.writingGenerationTemperature }
      : {}),
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
  if (extensions.outlineMaxChars !== undefined) {
    target.outlineMaxChars = clampOutlineMaxChars(extensions.outlineMaxChars);
  }
  if (extensions.personaProfileMaxChars !== undefined) {
    target.personaProfileMaxChars = clampPersonaProfileMaxChars(extensions.personaProfileMaxChars);
  }
  if (extensions.relationMemoMaxChars !== undefined) {
    target.relationMemoMaxChars = clampRelationMemoMaxChars(extensions.relationMemoMaxChars);
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
  if (Array.isArray(extensions.writingStyleSamples)) {
    target.writingStyleSamples = sanitizeWritingStyleSamples(extensions.writingStyleSamples);
  }
  if (extensions.generationWritingModel !== undefined) {
    target.generationWritingModel =
      extensions.generationWritingModel === null
        ? null
        : normalizeGenerationModelId(extensions.generationWritingModel);
  }
  if (extensions.generationUtilityModel !== undefined) {
    target.generationUtilityModel =
      extensions.generationUtilityModel === null
        ? null
        : normalizeGenerationModelId(extensions.generationUtilityModel);
  }
  if (extensions.writingGenerationTemperature !== undefined) {
    target.writingGenerationTemperature = resolveWritingGenerationTemperatureOverride(
      extensions.writingGenerationTemperature
    );
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
  outlineMaxChars?: number;
  personaProfileMaxChars?: number;
  relationMemoMaxChars?: number;
  generationTemperature: number;
  updatePersonaOnSave?: boolean;
  generateRelationEventsOnSave?: boolean;
  chapterOptimizeSegmentCharSize?: number;
  contentSafetyScanEnabled?: boolean;
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
  writingStyleSamples?: WritingStyleSample[];
  generationWritingModel?: string | null;
  generationUtilityModel?: string | null;
  writingGenerationTemperature?: number | null;
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
    outlineMaxChars: clampOutlineMaxChars(settings.outlineMaxChars ?? DEFAULT_OUTLINE_MAX_CHARS),
    personaProfileMaxChars: clampPersonaProfileMaxChars(
      settings.personaProfileMaxChars ?? DEFAULT_PERSONA_PROFILE_MAX_CHARS
    ),
    relationMemoMaxChars: clampRelationMemoMaxChars(
      settings.relationMemoMaxChars ?? DEFAULT_RELATION_MEMO_MAX_CHARS
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
    writingStyleSamples: sanitizeWritingStyleSamples(settings.writingStyleSamples).map((item) => ({
      ...item,
    })),
    ...(settings.generationWritingModel !== undefined
      ? { generationWritingModel: settings.generationWritingModel }
      : {}),
    ...(settings.generationUtilityModel !== undefined
      ? { generationUtilityModel: settings.generationUtilityModel }
      : {}),
    ...(settings.writingGenerationTemperature !== undefined
      ? { writingGenerationTemperature: settings.writingGenerationTemperature }
      : {}),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export const PROJECT_SETTINGS_JSON_EXTENSION_DEFAULTS = {
  priorChapterTailChars: DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
  contextExcerptMaxChars: DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  outlineMaxChars: DEFAULT_OUTLINE_MAX_CHARS,
  personaProfileMaxChars: DEFAULT_PERSONA_PROFILE_MAX_CHARS,
  relationMemoMaxChars: DEFAULT_RELATION_MEMO_MAX_CHARS,
  updatePersonaOnSave: true,
  generateRelationEventsOnSave: true,
  chapterOptimizeSegmentCharSize: DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
  contentSafetyScanEnabled: true,
  contentSafetyCustomRules: [] as ProjectContentSafetyRule[],
  writingStyleSamples: [] as WritingStyleSample[],
  generationWritingModel: null as string | null,
  generationUtilityModel: null as string | null,
  writingGenerationTemperature: null as number | null,
};
