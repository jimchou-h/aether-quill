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
    '请直接输出「优化后的章节正文」纯文本，不要输出方案、说明、Markdown 标题或代码块。必须基于 <chapter-original> 逐段改写并完整覆盖原文信息，不得遗漏关键情节、对白、人物动作与指代关系；若某段无需修改请保留原意并输出该段。除非优化方案明确要求删减，输出总字数应不低于原文的95%，段落数不得少于原文。'
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
export function makeOptimizationId(prefix: 'plan' | 'draft' | 'typo-check' | 'typo-fix'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChapterTypoIssueRecord {
  id: string;
  original: string;
  suggestion: string;
  context?: string;
  reason?: string;
}

export const CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY = 'chapter.optimize.typo-check';
export const CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY = 'chapter.optimize.typo-fix';

export const CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT = [
  '你是一位资深中文小说校对编辑，专门检查章节正文中的错别字、同音误用、标点错误和明显语病。',
  '本步骤只输出 JSON，不要输出任何解释、Markdown 或代码块标记。',
  'JSON 结构必须为：',
  '{"issues":[{"id":"issue-1","original":"原文片段","suggestion":"建议修改","context":"上下文","reason":"原因"}]}',
  '规则：',
  '1) issues 数组可为空（表示未发现错字）；',
  '2) original 必须是 draft 中真实存在的连续片段；',
  '3) suggestion 为替换 original 后的正确写法；',
  '4) 不要编造不存在的错字，不要修改专有名词除非明显错误；',
  '5) id 使用 issue-1、issue-2 递增。',
].join('\n');

export const CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT = [
  '你是一位资深中文小说校对编辑，正在将错字修正建议全部应用到章节草稿正文中。',
  '本步骤需要直接输出「修正后的完整正文」纯文本，不要输出 JSON、方案、说明或 Markdown。',
  '硬约束：',
  '1) 必须应用 <typo-issues> 中的全部修正建议；',
  '2) 除错字修正外，不得擅自改写情节、人物对白或段落结构；',
  '3) 不得使用占位语；',
  '4) 保持原文语言风格、人称与时态。',
].join('\n');

export function buildTypoCheckUserPrompt(draftText: string): string {
  return [
    '【待检查正文】',
    `<draft-text>\n${draftText.trim()}\n</draft-text>`,
    '请检查以上正文中的错别字与明显语病，按约定 JSON 格式输出 issues 列表。',
  ].join('\n\n');
}

export function buildTypoFixUserPrompt(
  draftText: string,
  issues: ChapterTypoIssueRecord[]
): string {
  const issueLines =
    issues.length > 0
      ? issues
          .map(
            (issue, index) =>
              `${index + 1}. [${issue.id}] 「${issue.original}」→「${issue.suggestion}」${issue.reason ? `（${issue.reason}）` : ''}`
          )
          .join('\n')
      : '（无待修正项，请原样输出正文）';

  return [
    '【修正要求】请将以下全部错字建议应用到正文，并输出修正后的完整正文。',
    `<typo-issues>\n${issueLines}\n</typo-issues>`,
    `<draft-text>\n${draftText.trim()}\n</draft-text>`,
    '请直接输出修正后的完整正文纯文本。',
  ].join('\n\n');
}

export interface Segment {
  index: number;
  originalText: string;
  planExcerpt: string;
  startParagraph: number;
  endParagraph: number;
}

export interface SegmentPromptInput {
  segment: Segment;
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
  previousSegmentSummary?: string;
  totalSegments: number;
}

const SEGMENT_SUMMARY_PREFIX = '【SEG_SUMMARY】';

export function splitIntoSegments(content: string, planText: string, maxSegments = 3): Segment[] {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) {
    return [];
  }
  if (paragraphs.length <= maxSegments) {
    return paragraphs.map((p, i) => ({
      index: i,
      originalText: p.trim(),
      planExcerpt: planText,
      startParagraph: i,
      endParagraph: i,
    }));
  }

  const segSize = Math.ceil(paragraphs.length / maxSegments);
  const adjustedSegments: Array<{ start: number; end: number }> = [];

  for (let start = 0; start < paragraphs.length; start += segSize) {
    let end = Math.min(start + segSize, paragraphs.length) - 1;

    const lastPara = paragraphs[end] || '';
    if (end < paragraphs.length - 1 && /[""』』」」""]$/.test(lastPara.trim())) {
      end = Math.min(end + 1, paragraphs.length - 1);
    }

    if (adjustedSegments.length === 0) {
      adjustedSegments.push({ start, end });
    } else {
      const prev = adjustedSegments[adjustedSegments.length - 1]!;
      adjustedSegments.push({ start: prev.end + 1, end: Math.max(prev.end + 1, end) });
    }
  }

  return adjustedSegments.map((seg, index) => {
    const text = paragraphs.slice(seg.start, seg.end + 1).join('\n\n');
    return {
      index,
      originalText: text.trim(),
      planExcerpt: planText,
      startParagraph: seg.start,
      endParagraph: seg.end,
    };
  });
}

export function buildSegmentPrompt(input: SegmentPromptInput): string {
  const {
    segment,
    chapter,
    instruction,
    planText,
    appearingCharacters,
    selectedRelationEvents,
    previousSegmentSummary,
    totalSegments,
  } = input;

  const sections: string[] = [];

  sections.push(
    `【系统指令】当前正在生成第 ${segment.index + 1}/${totalSegments} 段，请聚焦本段原文进行改写，确保完整覆盖。`
  );

  sections.push(`【章节信息】第${chapter.chapterNo}章「${chapter.title}」`);
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, i) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${i + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(`<optimization-plan>\n${planText.trim()}\n</optimization-plan>`);

  if (previousSegmentSummary) {
    sections.push(`【前段正文摘要】\n${previousSegmentSummary}`);
  }

  sections.push(`<segment-original>\n${segment.originalText}\n</segment-original>`);

  sections.push(
    '请直接输出优化后的本段正文。末尾另起一行输出 `【SEG_SUMMARY】本段摘要内容`（供下段使用）。确保完整覆盖原文内容，不得遗漏情节、对白、动作描写。不得使用「同上」「同前」「此处省略」「原段落保留」等占位语。若本段无需修改，则原样输出并附摘要。'
  );

  return sections.join('\n\n');
}

export function parseSegmentOutput(output: string): { segmentText: string; summary: string } {
  const summaryIndex = output.lastIndexOf(SEGMENT_SUMMARY_PREFIX);
  if (summaryIndex === -1) {
    const trimmed = output.trim();
    const lastSentence =
      trimmed
        .split(/[。！？\n]/)
        .filter(Boolean)
        .pop() || trimmed.slice(-80);
    return { segmentText: trimmed, summary: lastSentence };
  }
  const segmentText = output.slice(0, summaryIndex).trim();
  const summary = output.slice(summaryIndex + SEGMENT_SUMMARY_PREFIX.length).trim();
  return { segmentText, summary };
}

export function calculateSegmentMaxTokens(originalText: string): number {
  const charCount = originalText.length;
  const estimated = Math.ceil(charCount * 1.5);
  return Math.max(2048, Math.min(estimated, 4096));
}

export function parseTypoCheckIssues(raw: unknown): ChapterTypoIssueRecord[] {
  let payload = raw;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
  }

  const items = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { issues?: unknown[] }).issues)
      ? (payload as { issues: unknown[] }).issues
      : [];

  const issues: ChapterTypoIssueRecord[] = [];
  let index = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const original = typeof record.original === 'string' ? record.original.trim() : '';
    const suggestion = typeof record.suggestion === 'string' ? record.suggestion.trim() : '';
    if (!original || !suggestion || original === suggestion) {
      continue;
    }
    index += 1;
    const id =
      typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `issue-${index}`;
    const context = typeof record.context === 'string' ? record.context.trim() : undefined;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : undefined;
    issues.push({
      id,
      original,
      suggestion,
      context: context || undefined,
      reason: reason || undefined,
    });
  }

  return issues;
}
