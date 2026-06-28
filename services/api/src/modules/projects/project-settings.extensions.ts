import type { ProjectContentSafetyRule } from '@aether-quill/config';
import { sanitizeProjectContentSafetyRules } from '@aether-quill/config';
import type { PersistedProjectState } from './persisted-workspace.types';
import {
  clampChapterOptimizeSegmentCharSize,
  DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE,
} from './chapter-optimize.util';
import {
  clampContextExcerptMaxChars,
  clampPriorChapterTailChars,
  DEFAULT_CONTEXT_EXCERPT_MAX_CHARS,
  DEFAULT_PRIOR_CHAPTER_TAIL_CHARS,
} from './project-settings.util';

/** PG `project_settings` 表未收录的字段，以 JSON 镜像为准 */
export type ProjectSettingsJsonExtensions = {
  priorChapterTailChars?: number;
  contextExcerptMaxChars?: number;
  updatePersonaOnSave?: boolean;
  generateRelationEventsOnSave?: boolean;
  chapterOptimizeSegmentCharSize?: number;
  contentSafetyScanEnabled?: boolean;
  contentSafetyCustomRules?: ProjectContentSafetyRule[];
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
};
