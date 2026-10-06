export const WRITING_STYLE_SAMPLE_SCENE_TYPES = [
  'dialogue',
  'action',
  'intimate',
  'atmosphere',
] as const;

export type WritingStyleSampleSceneType = (typeof WRITING_STYLE_SAMPLE_SCENE_TYPES)[number];

export interface WritingStyleSample {
  id: string;
  text: string;
  sceneType: WritingStyleSampleSceneType;
  sourceChapterNo?: number;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export const WRITING_STYLE_SAMPLE_MIN_CHARS = 50;
export const WRITING_STYLE_SAMPLE_MAX_CHARS = 800;
export const WRITING_STYLE_SAMPLES_MAX_PER_PROJECT = 12;
export const WRITING_STYLE_INJECTION_MAX_SAMPLES = 2;

const SCENE_TYPE_SET = new Set<string>(WRITING_STYLE_SAMPLE_SCENE_TYPES);

export function isWritingStyleSampleSceneType(value: string): value is WritingStyleSampleSceneType {
  return SCENE_TYPE_SET.has(value);
}

export function sanitizeWritingStyleSamples(raw: unknown): WritingStyleSample[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const samples: WritingStyleSample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Partial<WritingStyleSample>;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    const sceneType = typeof row.sceneType === 'string' ? row.sceneType.trim() : '';
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || !text || !isWritingStyleSampleSceneType(sceneType)) {
      continue;
    }
    if (
      text.length < WRITING_STYLE_SAMPLE_MIN_CHARS ||
      text.length > WRITING_STYLE_SAMPLE_MAX_CHARS
    ) {
      continue;
    }
    const sourceChapterNo =
      typeof row.sourceChapterNo === 'number' &&
      Number.isInteger(row.sourceChapterNo) &&
      row.sourceChapterNo >= 1
        ? row.sourceChapterNo
        : undefined;
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, 80) : undefined;
    const createdAt =
      typeof row.createdAt === 'string' && row.createdAt.trim()
        ? row.createdAt.trim()
        : new Date().toISOString();
    const updatedAt =
      typeof row.updatedAt === 'string' && row.updatedAt.trim() ? row.updatedAt.trim() : createdAt;
    samples.push({
      id,
      text,
      sceneType,
      ...(sourceChapterNo !== undefined ? { sourceChapterNo } : {}),
      ...(label ? { label } : {}),
      createdAt,
      updatedAt,
    });
  }
  return samples.slice(0, WRITING_STYLE_SAMPLES_MAX_PER_PROJECT);
}

/** 写作类任务 templateKey：续写、优化 draft、pipeline 改写 / revise / fix-items */
export function isWritingStyleInjectionTemplateKey(templateKey: string): boolean {
  const key = templateKey.trim();
  if (!key) {
    return false;
  }
  if (key === 'write.chapter') {
    return true;
  }
  if (
    key === 'chapter.optimize.draft' ||
    key === 'chapter.optimize.direct-draft' ||
    key === 'chapter.optimize.loop.draft' ||
    key === 'chapter.optimize.workbench-draft-sex' ||
    key === 'chapter.optimize.workbench-draft-prose' ||
    key === 'chapter.optimize.workbench-draft-scene'
  ) {
    return true;
  }
  return false;
}

/** 返回 null 表示不限制场景类型（通用写作任务） */
export function resolveSceneTypesForTemplateKey(
  templateKey: string
): WritingStyleSampleSceneType[] | null {
  const key = templateKey.trim();
  if (key === 'chapter.optimize.workbench-draft-sex') {
    return ['intimate'];
  }
  return null;
}

function compareSamplesForSelection(
  a: WritingStyleSample,
  b: WritingStyleSample,
  preferredSet: Set<WritingStyleSampleSceneType> | null
): number {
  if (preferredSet) {
    const aMatch = preferredSet.has(a.sceneType) ? 0 : 1;
    const bMatch = preferredSet.has(b.sceneType) ? 0 : 1;
    if (aMatch !== bMatch) {
      return aMatch - bMatch;
    }
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function selectWritingStyleSamplesForTask(input: {
  samples: WritingStyleSample[];
  templateKey: string;
  chapterNo?: number;
  limit?: number;
}): WritingStyleSample[] {
  const limit = input.limit ?? WRITING_STYLE_INJECTION_MAX_SAMPLES;
  const chapterNo =
    typeof input.chapterNo === 'number' && Number.isFinite(input.chapterNo) && input.chapterNo > 0
      ? input.chapterNo
      : undefined;

  const candidates = input.samples.filter(
    (sample) => chapterNo === undefined || sample.sourceChapterNo !== chapterNo
  );
  if (candidates.length === 0) {
    return [];
  }

  const preferred = resolveSceneTypesForTemplateKey(input.templateKey);
  const preferredSet = preferred ? new Set(preferred) : null;
  const ranked = [...candidates].sort((a, b) => compareSamplesForSelection(a, b, preferredSet));

  const picked: WritingStyleSample[] = [];
  const usedIds = new Set<string>();
  const usedScenes = new Set<WritingStyleSampleSceneType>();

  for (const sample of ranked) {
    if (picked.length >= limit) {
      break;
    }
    if (!preferredSet && usedScenes.has(sample.sceneType)) {
      continue;
    }
    picked.push(sample);
    usedIds.add(sample.id);
    usedScenes.add(sample.sceneType);
  }

  if (picked.length < limit) {
    for (const sample of ranked) {
      if (picked.length >= limit) {
        break;
      }
      if (usedIds.has(sample.id)) {
        continue;
      }
      picked.push(sample);
      usedIds.add(sample.id);
    }
  }

  if (preferredSet && picked.every((sample) => !preferredSet.has(sample.sceneType))) {
    return candidates.slice(0, limit);
  }

  return picked.slice(0, limit);
}

const SCENE_TYPE_LABELS: Record<WritingStyleSampleSceneType, string> = {
  dialogue: '对白戏',
  action: '动作戏',
  intimate: '亲密戏',
  atmosphere: '心理氛围',
};

export function buildStyleSamplePromptBlock(samples: WritingStyleSample[]): string {
  if (samples.length === 0) {
    return '';
  }
  const blocks = samples.map((sample) => {
    const sceneLabel = SCENE_TYPE_LABELS[sample.sceneType] ?? sample.sceneType;
    const labelLine = sample.label ? `\n<!-- label: ${sample.label} -->` : '';
    return `<style-sample scene="${sample.sceneType}" label="${sceneLabel}">${labelLine}\n${sample.text.trim()}\n</style-sample>`;
  });
  return [
    '【文风参照】',
    '以下片段仅作语感、句式节奏与用词密度参考；勿复用其中情节、人物关系与具体意象。',
    ...blocks,
  ].join('\n\n');
}

export function resolveWritingStyleSampleBlock(input: {
  samples: WritingStyleSample[];
  templateKey: string;
  chapterNo?: number;
}): string | undefined {
  if (!isWritingStyleInjectionTemplateKey(input.templateKey)) {
    return undefined;
  }
  const selected = selectWritingStyleSamplesForTask({
    samples: input.samples,
    templateKey: input.templateKey,
    chapterNo: input.chapterNo,
  });
  if (selected.length === 0) {
    return undefined;
  }
  const block = buildStyleSamplePromptBlock(selected).trim();
  return block || undefined;
}
