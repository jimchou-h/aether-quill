/**
 * 章节优化工具（AQ-113）
 *
 * 提供 plan / draft user prompt 拼装、章节版本乐观锁校验、instruction 校验等纯函数。
 *
 * 模板治理同步入口：`packages/prompt-templates/src/templates.ts`
 *  - chapterOptimizePlanTemplate
 *  - chapterOptimizeDraftTemplate
 * 任何一边变更，都必须同步另一边，避免运行时与治理副本漂移。
 */

export interface ChapterOptimizeChapterRef {
  chapterNo: number;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface ChapterOptimizeUsedRelationEvent {
  id: string;
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
}

export const CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY = 'chapter.optimize.plan';
export const CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY = 'chapter.optimize.draft';

export const CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在协助用户对一段已存在的章节正文进行定向优化。',
  '本步骤只需要输出「优化方案」，不要直接输出新的正文。',
  '方案应当结构化、按段落或要点列出，覆盖：',
  '1) 用户要求与章节现状的差距诊断；',
  '2) 计划改写的段落 / 情节 / 对白 / 人物动机；',
  '3) 计划保留的关键事件与人物状态；',
  '4) 风险与一致性提示（如与大纲、人物状态、关系事件的冲突点）。',
  '请始终参考下文 <chapter-original> 标签中的原章节正文，不得凭空想象。',
].join('\n');

export const CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按照已确认的优化方案重写一段已有章节正文。',
  '本步骤需要直接输出「优化后的章节正文」，不要输出任何方案、说明、Markdown 标题或代码块包裹。',
  '硬约束：',
  '1) 必须以下文 <chapter-original> 中的原章节正文为蓝本进行改写，禁止凭摘要扩写；',
  '2) 必须严格遵循 <optimization-plan> 中已确认的优化方案；',
  '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
  '4) 输出语言、人称、时态、人物名称必须与原文保持一致，除非方案明确要求修改；',
  '5) 输出风格必须与项目 systemPrompt 与人物设定保持一致。',
].join('\n');

export function normalizeInstruction(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function assertInstruction(value: string): void {
  if (!value) {
    throw new Error('优化要求 instruction 不能为空');
  }
  if (value.length > 2000) {
    throw new Error('优化要求 instruction 长度不能超过 2000 字符');
  }
}

export function assertPlanText(value: string): void {
  if (!value || !value.trim()) {
    throw new Error('优化方案 planText 不能为空');
  }
}

export function assertDraftText(value: string): void {
  if (!value || !value.trim()) {
    throw new Error('优化正文 draftText 不能为空');
  }
}

export function buildPlanUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, appearingCharacters, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(`【优化目标】请对第${chapter.chapterNo}章「${chapter.title}」进行优化。`);
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${chapter.content}\n</chapter-original>`
  );

  sections.push('请基于以上信息输出「优化方案」，结构化呈现要点，禁止直接输出新的正文。');

  return sections.join('\n\n');
}

export function buildDraftUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, planText, appearingCharacters, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(
    `【写作目标】请按已确认的优化方案重写第${chapter.chapterNo}章「${chapter.title}」的正文。`
  );
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<optimization-plan chapter-no="${chapter.chapterNo}">\n${planText.trim()}\n</optimization-plan>`
  );
  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${chapter.content}\n</chapter-original>`
  );

  sections.push(
    '请直接输出「优化后的章节正文」纯文本，不要输出方案、说明、Markdown 标题或代码块。'
  );

  return sections.join('\n\n');
}

/**
 * 章节版本乐观锁：把传入的 ISO 字符串与当前章节 updatedAt 做毫秒级比对。
 * 比对失败抛出 `CHAPTER_VERSION_CONFLICT`，service 层将其映射为业务错误码 1307。
 */
export class ChapterVersionConflictError extends Error {
  constructor(
    public readonly chapterNo: number,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`章节第${chapterNo}章版本不匹配：expected=${expected} actual=${actual}`);
    this.name = 'ChapterVersionConflictError';
  }
}

export function parseExpectedUpdatedAt(value: unknown): Date {
  if (!value || typeof value !== 'string') {
    throw new Error('expectedChapterUpdatedAt 必须为 ISO 时间字符串');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('expectedChapterUpdatedAt 不是合法的 ISO 时间字符串');
  }
  return parsed;
}

export function ensureChapterVersionMatches(chapterNo: number, expected: Date, actual: Date): void {
  if (expected.getTime() !== actual.getTime()) {
    throw new ChapterVersionConflictError(chapterNo, expected.toISOString(), actual.toISOString());
  }
}

/**
 * 用稳定的伪随机生成 planId / draftId，便于 trace 关联。
 */
export function makeOptimizationId(prefix: 'plan' | 'draft'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
