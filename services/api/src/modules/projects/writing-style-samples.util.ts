import { randomUUID } from 'node:crypto';
import {
  WRITING_STYLE_SAMPLE_MAX_CHARS,
  WRITING_STYLE_SAMPLE_MIN_CHARS,
  isWritingStyleSampleSceneType,
  sanitizeWritingStyleSamples,
  type WritingStyleSample,
  type WritingStyleSampleSceneType,
} from '@aether-quill/config';

export {
  WRITING_STYLE_SAMPLE_MAX_CHARS,
  WRITING_STYLE_SAMPLE_MIN_CHARS,
  WRITING_STYLE_SAMPLE_SCENE_TYPES,
  WRITING_STYLE_SAMPLES_MAX_PER_PROJECT,
  isWritingStyleInjectionTemplateKey,
  resolveSceneTypesForTemplateKey,
  selectWritingStyleSamplesForTask,
  buildStyleSamplePromptBlock,
  resolveWritingStyleSampleBlock,
  type WritingStyleSample,
  type WritingStyleSampleSceneType,
} from '@aether-quill/config';

export function validateWritingStyleSampleInput(input: {
  text?: string;
  sceneType?: string;
  sourceChapterNo?: number | null;
  label?: string;
}):
  | {
      ok: true;
      data: {
        text: string;
        sceneType: WritingStyleSampleSceneType;
        sourceChapterNo?: number;
        label?: string;
      };
    }
  | { ok: false; message: string } {
  const text = input.text?.trim() ?? '';
  if (text.length < WRITING_STYLE_SAMPLE_MIN_CHARS) {
    return { ok: false, message: `文风样本文本至少 ${WRITING_STYLE_SAMPLE_MIN_CHARS} 字` };
  }
  if (text.length > WRITING_STYLE_SAMPLE_MAX_CHARS) {
    return { ok: false, message: `文风样本文本不能超过 ${WRITING_STYLE_SAMPLE_MAX_CHARS} 字` };
  }
  const sceneType = input.sceneType?.trim() ?? '';
  if (!isWritingStyleSampleSceneType(sceneType)) {
    return { ok: false, message: '无效的场景类型标签' };
  }
  const sourceChapterNo =
    input.sourceChapterNo === null || input.sourceChapterNo === undefined
      ? undefined
      : input.sourceChapterNo;
  if (
    sourceChapterNo !== undefined &&
    (!Number.isInteger(sourceChapterNo) || sourceChapterNo < 1)
  ) {
    return { ok: false, message: 'sourceChapterNo 须为正整数' };
  }
  const label = input.label?.trim();
  if (label && label.length > 80) {
    return { ok: false, message: 'label 不能超过 80 字' };
  }
  return {
    ok: true,
    data: {
      text,
      sceneType,
      ...(sourceChapterNo !== undefined ? { sourceChapterNo } : {}),
      ...(label ? { label } : {}),
    },
  };
}

export function createWritingStyleSampleRecord(input: {
  text: string;
  sceneType: WritingStyleSampleSceneType;
  sourceChapterNo?: number;
  label?: string;
}): WritingStyleSample {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    text: input.text,
    sceneType: input.sceneType,
    ...(input.sourceChapterNo !== undefined ? { sourceChapterNo: input.sourceChapterNo } : {}),
    ...(input.label ? { label: input.label } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export { sanitizeWritingStyleSamples };
