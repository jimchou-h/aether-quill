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
  '5) 输出风格必须与项目 systemPrompt 与人物设定保持一致；',
  '6) 若提示中含【边界锚点】/【前段末文】，锚点与末文仅用于把握衔接，不得照抄进正文；',
  '7) 须遵守边界锚点：段首承接上段原文末句之后、段末落点不越过本段原文末句；禁止提前写入下段原文首句之后的情节；',
  '8) 中段（非首段且非末段）不得写章节总结、情绪收束或悬念式章末收尾。',
].join('\n');

/** 低于此字数优先单段生成，减少硬切分 */
export const OPTIMIZE_SINGLE_SEGMENT_CHAR_THRESHOLD = 2800;
export const OPTIMIZE_TWO_SEGMENT_CHAR_THRESHOLD = 5500;
export const SEGMENT_TAIL_CONTEXT_CHARS = 400;
export const SEGMENT_LEAD_CONTEXT_CHARS = 200;
/** 中段 maxTokens 相对原文字符上限倍率（抑制越界扩写） */
export const MIDDLE_SEGMENT_MAX_TOKEN_CHAR_RATIO = 1.15;
export const SEGMENT_LENGTH_RETRY_RATIO = 1.35;

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

export interface SegmentBoundaryAnchors {
  previousOriginalLastSentence?: string;
  currentOriginalFirstSentence: string;
  currentOriginalLastSentence: string;
  nextOriginalFirstSentence?: string;
}

export interface SegmentPromptInput {
  segment: Segment;
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
  previousSegmentSummary?: string;
  /** 上一段已生成正文的末尾片段，用于语气/场景衔接 */
  previousSegmentTail?: string;
  /** 原文边界句锚点（情节范围） */
  boundaryAnchors?: SegmentBoundaryAnchors;
  totalSegments: number;
}

export function splitChapterParagraphs(content: string): string[] {
  return content.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

const SENTENCE_SPLIT_RE = /(?<=[。！？…])/;

export function extractFirstSentence(text: string, fallbackChars = 80): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts[0]!;
  }
  return trimmed.length <= fallbackChars ? trimmed : `${trimmed.slice(0, fallbackChars)}…`;
}

export function extractLastSentence(text: string, fallbackChars = 80): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts[parts.length - 1]!;
  }
  return trimmed.length <= fallbackChars ? trimmed : `…${trimmed.slice(-fallbackChars)}`;
}

export function buildSegmentBoundaryAnchors(
  segment: Segment,
  allSegments: Segment[]
): SegmentBoundaryAnchors {
  const currentOriginalFirstSentence = extractFirstSentence(segment.originalText);
  const currentOriginalLastSentence = extractLastSentence(segment.originalText);

  const previousSegment = segment.index > 0 ? allSegments[segment.index - 1] : undefined;
  const nextSegment =
    segment.index < allSegments.length - 1 ? allSegments[segment.index + 1] : undefined;

  return {
    previousOriginalLastSentence: previousSegment
      ? extractLastSentence(previousSegment.originalText)
      : undefined,
    currentOriginalFirstSentence,
    currentOriginalLastSentence,
    nextOriginalFirstSentence: nextSegment
      ? extractFirstSentence(nextSegment.originalText)
      : undefined,
  };
}

export function resolveOptimizeSegmentCount(contentLength: number, maxSegments = 3): number {
  const max = Math.max(1, Math.min(3, Math.trunc(maxSegments)));
  if (contentLength <= OPTIMIZE_SINGLE_SEGMENT_CHAR_THRESHOLD) {
    return 1;
  }
  if (contentLength <= OPTIMIZE_TWO_SEGMENT_CHAR_THRESHOLD) {
    return Math.min(2, max);
  }
  return max;
}

export function extractSegmentTailText(text: string, maxChars = SEGMENT_TAIL_CONTEXT_CHARS): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return trimmed.slice(-maxChars);
}

export function extractSegmentLeadText(text: string, maxChars = SEGMENT_LEAD_CONTEXT_CHARS): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const firstParagraph = trimmed.split(/\n\n+/)[0]?.trim() || trimmed;
  if (firstParagraph.length <= maxChars) {
    return firstParagraph;
  }
  return `${firstParagraph.slice(0, maxChars)}…`;
}

function scoreParagraphBreakPoint(paragraph: string, nextParagraph?: string): number {
  let score = 0;
  const trimmed = paragraph.trim();
  if (/[。！？…]["”』」]?$/.test(trimmed)) {
    score += 3;
  }
  if (nextParagraph && /^[「『"'“]/.test(nextParagraph.trim())) {
    score += 2;
  }
  if (trimmed.length < 40) {
    score -= 1;
  }
  return score;
}

function pickBreakParagraphIndex(paragraphs: string[], targetEnd: number, searchRadius = 2): number {
  const min = Math.max(0, targetEnd - searchRadius);
  const max = Math.min(paragraphs.length - 1, targetEnd + searchRadius);
  let best = targetEnd;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = min; i <= max; i += 1) {
    const score = scoreParagraphBreakPoint(paragraphs[i] || '', paragraphs[i + 1]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
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

  for (let start = 0; start < paragraphs.length; ) {
    const targetEnd = Math.min(start + segSize, paragraphs.length) - 1;
    let end =
      adjustedSegments.length < maxSegments - 1
        ? pickBreakParagraphIndex(paragraphs, targetEnd)
        : paragraphs.length - 1;
    end = Math.max(start, Math.min(end, paragraphs.length - 1));

    if (adjustedSegments.length === 0) {
      adjustedSegments.push({ start, end });
    } else {
      const prev = adjustedSegments[adjustedSegments.length - 1]!;
      const nextStart = prev.end + 1;
      if (nextStart >= paragraphs.length) {
        break;
      }
      end = Math.max(nextStart, end);
      adjustedSegments.push({ start: nextStart, end });
    }

    start = end + 1;
    if (adjustedSegments.length >= maxSegments) {
      break;
    }
  }

  const last = adjustedSegments[adjustedSegments.length - 1];
  if (last && last.end < paragraphs.length - 1) {
    last.end = paragraphs.length - 1;
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

function formatBoundaryAnchorsBlock(anchors: SegmentBoundaryAnchors, segmentIndex: number): string {
  const lines = ['【边界锚点·只读】'];
  if (anchors.previousOriginalLastSentence) {
    lines.push(
      `- 上段原文末句：「${anchors.previousOriginalLastSentence}」（本段须从此句之后自然承接，不得重复该句）`
    );
  } else if (segmentIndex > 0) {
    lines.push('- 上段原文末句：（无，本段为章节后续部分）');
  }
  lines.push(
    `- 本段原文首句：「${anchors.currentOriginalFirstSentence}」（改写后首句应与之语义等价或顺滑替换）`
  );
  lines.push(
    `- 本段原文末句：「${anchors.currentOriginalLastSentence}」（改写后末句应落在此句附近，不得写到更后情节）`
  );
  if (anchors.nextOriginalFirstSentence) {
    lines.push(
      `- 下段原文首句：「${anchors.nextOriginalFirstSentence}」（禁止提前写入；本段不得出现该句之后的情节或章末式收束）`
    );
  }
  return lines.join('\n');
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
    previousSegmentTail,
    boundaryAnchors,
    totalSegments,
  } = input;

  const sections: string[] = [];
  const isMiddleSegment = totalSegments > 2 && segment.index > 0 && segment.index < totalSegments - 1;

  sections.push(
    `【系统指令】当前正在生成第 ${segment.index + 1}/${totalSegments} 段，请聚焦本段原文进行改写，确保完整覆盖。`
  );

  if (totalSegments > 1) {
    sections.push(
      '【衔接要求】本段须与前后段在时序、场景、人称上自然连贯；段首勿重复前段已写内容，段末勿写「总之」「与此同时」等收束句。'
    );
    if (segment.startParagraph === segment.endParagraph) {
      sections.push(
        `【本段范围】仅改写原文第 ${segment.startParagraph + 1} 段（以空行分段计），不得写到其他段落的情节。`
      );
    } else {
      sections.push(
        `【本段范围】仅改写原文第 ${segment.startParagraph + 1}–${segment.endParagraph + 1} 段（以空行分段计），不得写到其他段落的情节。`
      );
    }
  }

  if (isMiddleSegment) {
    sections.push(
      '【中段专用】本段是章节「过渡段」，不是章节结尾。禁止：章节总结、情绪收束、悬念式章末收尾、写下一段已发生的事件或对白。'
    );
  }

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

  if (boundaryAnchors) {
    sections.push(formatBoundaryAnchorsBlock(boundaryAnchors, segment.index));
  }

  if (previousSegmentTail) {
    sections.push(
      `【前段末文（语气参考，不要照抄；情节边界以上方「边界锚点」为准）】\n${previousSegmentTail}`
    );
  }

  if (previousSegmentSummary) {
    sections.push(`【前段情节摘要】\n${previousSegmentSummary}`);
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

export function calculateSegmentMaxTokensForIndex(
  originalText: string,
  segmentIndex: number,
  totalSegments: number
): number {
  const base = calculateSegmentMaxTokens(originalText);
  const isMiddle =
    totalSegments > 2 && segmentIndex > 0 && segmentIndex < totalSegments - 1;
  if (!isMiddle) {
    return base;
  }
  const middleCap = Math.ceil(originalText.length * MIDDLE_SEGMENT_MAX_TOKEN_CHAR_RATIO);
  return Math.min(base, middleCap);
}

export function shouldRetrySegmentForLength(
  originalText: string,
  generatedText: string
): boolean {
  const originalLen = originalText.trim().length;
  if (originalLen <= 0) {
    return false;
  }
  return generatedText.trim().length > originalLen * SEGMENT_LENGTH_RETRY_RATIO;
}

export function appendSegmentLengthRetryHint(prompt: string): string {
  return `${prompt}\n\n【重试约束】上次输出超出本段原文情节范围。请严格限定在本段原文首句与末句之间，删除下段情节与章末收束，压缩至与本段原文相当的长度。`;
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
