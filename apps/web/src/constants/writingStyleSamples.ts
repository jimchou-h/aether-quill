import type { WritingStyleSampleSceneType } from '../services/api';

export const WRITING_STYLE_SAMPLE_MIN_CHARS = 50;
export const WRITING_STYLE_SAMPLE_MAX_CHARS = 800;
export const WRITING_STYLE_SAMPLES_MAX_PER_PROJECT = 12;

export const WRITING_STYLE_SCENE_TYPE_OPTIONS: Array<{
  value: WritingStyleSampleSceneType;
  label: string;
}> = [
  { value: 'dialogue', label: '对白戏' },
  { value: 'action', label: '动作戏' },
  { value: 'intimate', label: '亲密戏' },
  { value: 'atmosphere', label: '心理氛围' },
];

export function writingStyleSceneTypeLabel(sceneType: WritingStyleSampleSceneType): string {
  return (
    WRITING_STYLE_SCENE_TYPE_OPTIONS.find((item) => item.value === sceneType)?.label ?? sceneType
  );
}

export function validateWritingStyleSampleText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < WRITING_STYLE_SAMPLE_MIN_CHARS) {
    return `文风样本至少 ${WRITING_STYLE_SAMPLE_MIN_CHARS} 字`;
  }
  if (trimmed.length > WRITING_STYLE_SAMPLE_MAX_CHARS) {
    return `文风样本不能超过 ${WRITING_STYLE_SAMPLE_MAX_CHARS} 字`;
  }
  return null;
}

export function summarizeWritingStyleSampleText(text: string, max = 72): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}
