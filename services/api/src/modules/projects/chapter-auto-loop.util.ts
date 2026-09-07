/**
 * 章节自动优化循环工具（openspec: add-chapter-auto-optimize-loop）
 *
 * 与 `chapter-optimize.util.ts` 的 from-plan / direct 两条路径并列，提供第三种模式 `auto-loop`：
 * 「复诊 → 局部改写」为一轮，方案读上一轮成稿重新诊断，正文只重写命中段落。
 *
 * 模板治理同步入口（三处必须一致，漏一处的表现是 sync 失败时静默用错 prompt）：
 *  - 本文件 `CHAPTER_AUTO_LOOP_*_SYSTEM_PROMPT` 为运行时仓库默认种子
 *  - `services/api/src/modules/task-prompts/task-prompt-defaults.ts` 白名单
 *  - `services/rag-orchestrator/src/generation/task-prompt-defaults.ts` 兜底
 */

import { detectPlaceholderText, planAllowsContentReduction } from './chapter-optimize.util';

export const CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY = 'chapter.optimize.loop.plan';
export const CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY = 'chapter.optimize.loop.draft';

export const AUTO_LOOP_ROUND_MIN = 1;
export const AUTO_LOOP_ROUND_MAX = 3;
export const AUTO_LOOP_ROUND_DEFAULT = 2;

/** 单轮命中段落数上限的比例；用 floor 保守取整，避免小章节被整章覆盖 */
const AUTO_LOOP_HIT_RATIO = 0.35;
const AUTO_LOOP_HIT_FLOOR = 3;
const AUTO_LOOP_HIT_CEILING = 12;

/** 引文短于此长度时不做模糊挽救：太短会匹配到大量段落，救回反而更危险 */
const AUTO_LOOP_MIN_QUOTE_CHARS = 6;

/** 段级字数带宽（相对原段） */
const SEGMENT_MIN_RATIO = 0.5;
const SEGMENT_MAX_RATIO = 2.5;

/** 章级字数带宽（相对入库原文） */
const ROUND_MIN_RATIO = 0.9;
const ROUND_MIN_RATIO_WHEN_REDUCTION_ALLOWED = 0.6;
const ROUND_MAX_RATIO = 1.5;

/** 段级 max_tokens 带宽。局部改写只吐一段，给整章预算等于放任模型跑飞 */
const SEGMENT_MIN_MAX_TOKENS = 400;
const SEGMENT_MAX_MAX_TOKENS = 2000;
const SEGMENT_TOKENS_PER_CHAR = 4;

export type ChapterAutoLoopSeverity = 'high' | 'medium' | 'low';

export type ChapterAutoLoopItemStatus =
  | 'pending'
  | 'applied'
  | 'relocated'
  | 'skipped_unlocatable'
  | 'deferred'
  | 'rolled_back'
  | 'failed';

export interface ChapterAutoLoopItem {
  id: string;
  /** 模型声明的段落编号（1 起） */
  paragraphIndex: number;
  anchorQuote: string;
  severity: ChapterAutoLoopSeverity;
  issue: string;
  instruction: string;
  status: ChapterAutoLoopItemStatus;
  /** 定位校验后实际采用的段落编号 */
  resolvedParagraphIndex?: number;
  note?: string;
}

export interface IndexedParagraph {
  /** 1 起编号 */
  index: number;
  text: string;
  /** 本段之后紧跟的原始分隔串，用于无损拼回 */
  separator: string;
}

export interface IndexedParagraphs {
  /** 首段之前的原始空白，用于无损拼回 */
  prefix: string;
  /** 末段之后的原始空白，用于无损拼回 */
  suffix: string;
  paragraphs: IndexedParagraph[];
}

const SEVERITY_RANK: Record<ChapterAutoLoopSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const PARAGRAPH_SEPARATOR_PATTERN = /(\r?\n[ \t]*\r?\n[\s]*)/;

// ---------------------------------------------------------------------------
// 段落编号与无损拼回
// ---------------------------------------------------------------------------

/**
 * 按空行切段并从 1 开始编号。分隔串原样保留，使未改动段落可字节级还原。
 * 段内单换行不视为段落边界。
 */
export function splitIndexedParagraphs(source: string): IndexedParagraphs {
  const tokens = source.split(PARAGRAPH_SEPARATOR_PATTERN);
  const paragraphs: IndexedParagraph[] = [];
  let prefix = '';
  let pendingSeparator = '';

  tokens.forEach((token, position) => {
    const chunk = token ?? '';
    const isSeparator = position % 2 === 1;
    if (isSeparator || !chunk.trim()) {
      pendingSeparator += chunk;
      return;
    }
    if (paragraphs.length === 0) {
      prefix = pendingSeparator;
    } else {
      paragraphs[paragraphs.length - 1].separator = pendingSeparator;
    }
    pendingSeparator = '';
    paragraphs.push({ index: paragraphs.length + 1, text: chunk, separator: '' });
  });

  return { prefix, suffix: pendingSeparator, paragraphs };
}

/** 按原始分隔串拼回；`overrides` 中的段落用替换文本，其余原样。 */
export function joinIndexedParagraphs(
  indexed: IndexedParagraphs,
  overrides?: Map<number, string>
): string {
  let output = indexed.prefix;
  indexed.paragraphs.forEach((paragraph) => {
    output += overrides?.get(paragraph.index) ?? paragraph.text;
    output += paragraph.separator;
  });
  return output + indexed.suffix;
}

export interface ParagraphReplacement {
  paragraphIndex: number;
  text: string;
}

/**
 * 只替换命中段落。越界编号与空替换被忽略，
 * 因此未命中段落在结果中与输入逐字节相同。
 */
export function applyParagraphReplacements(
  indexed: IndexedParagraphs,
  replacements: ParagraphReplacement[]
): string {
  const overrides = new Map<number, string>();
  const maxIndex = indexed.paragraphs.length;
  replacements.forEach((replacement) => {
    if (replacement.paragraphIndex < 1 || replacement.paragraphIndex > maxIndex) {
      return;
    }
    const text = replacement.text.trim();
    if (!text) {
      return;
    }
    overrides.set(replacement.paragraphIndex, text);
  });
  return joinIndexedParagraphs(indexed, overrides);
}

/** 渲染成带 `[n]` 编号的正文，让模型只需照抄编号而不必自己数段。 */
export function renderIndexedParagraphs(indexed: IndexedParagraphs): string {
  return indexed.paragraphs
    .map((paragraph) => `[${paragraph.index}] ${paragraph.text}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// 条目解析
// ---------------------------------------------------------------------------

export interface ParsedAutoLoopPlanItems {
  items: ChapterAutoLoopItem[];
  /** 结构不合法被丢弃的条目数 */
  discardedCount: number;
  /** 整体无法解析为 JSON */
  parseFailed: boolean;
}

function stripCodeFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json|JSON)?\s*/u, '')
    .replace(/```$/u, '')
    .trim();
}

function extractJsonObject(raw: string): unknown {
  const stripped = stripCodeFence(raw);
  const candidates: string[] = [stripped];
  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(stripped.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = stripped.indexOf('[');
  const arrayEnd = stripped.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(stripped.slice(arrayStart, arrayEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isSeverity(value: unknown): value is ChapterAutoLoopSeverity {
  return value === 'high' || value === 'medium' || value === 'low';
}

/**
 * 解析复诊输出的结构化条目。脏数据丢弃并计数，绝不整体抛错——
 * 一轮复诊格式跑偏不该炸掉整个循环。
 */
export function parseAutoLoopPlanItems(raw: string): ParsedAutoLoopPlanItems {
  const parsed = extractJsonObject(raw);
  if (parsed === undefined) {
    return { items: [], discardedCount: 0, parseFailed: true };
  }

  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : undefined;
  if (!rawItems) {
    return { items: [], discardedCount: 0, parseFailed: true };
  }

  const items: ChapterAutoLoopItem[] = [];
  let discardedCount = 0;

  rawItems.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      discardedCount += 1;
      return;
    }
    const record = entry as Record<string, unknown>;
    const paragraphIndex = Number(record.paragraphIndex);
    const anchorQuote = typeof record.anchorQuote === 'string' ? record.anchorQuote.trim() : '';
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : '';
    const severity = record.severity;

    if (
      !Number.isInteger(paragraphIndex) ||
      paragraphIndex < 1 ||
      !anchorQuote ||
      !instruction ||
      !isSeverity(severity)
    ) {
      discardedCount += 1;
      return;
    }

    const providedId = typeof record.id === 'string' ? record.id.trim() : '';
    items.push({
      id: providedId || `item-${items.length + 1}`,
      paragraphIndex,
      anchorQuote,
      severity,
      issue: typeof record.issue === 'string' ? record.issue.trim() : '',
      instruction,
      status: 'pending',
    });
  });

  return { items, discardedCount, parseFailed: false };
}

// ---------------------------------------------------------------------------
// 定位双保险与两级降级
// ---------------------------------------------------------------------------

export type AutoLoopAnchorOutcome = 'exact' | 'relocated' | 'unlocatable';

export interface AutoLoopAnchorResult {
  outcome: AutoLoopAnchorOutcome;
  resolvedParagraphIndex: number | null;
  note?: string;
}

/** 归一化：去掉空白与标点，使引文的轻微改字不影响定位。 */
function normalizeForAnchor(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 编号与引文双保险定位。
 *
 * 1. 引文出现在声明段落 → `exact`
 * 2. 否则全章模糊匹配，唯一命中 → `relocated`
 * 3. 零命中或多命中 → `unlocatable`（宁可跳过，也不按可疑编号改错地方）
 */
export function resolveItemAnchor(input: {
  item: Pick<ChapterAutoLoopItem, 'paragraphIndex' | 'anchorQuote'>;
  paragraphs: IndexedParagraph[];
}): AutoLoopAnchorResult {
  const normalizedQuote = normalizeForAnchor(input.item.anchorQuote);
  if (!normalizedQuote) {
    return { outcome: 'unlocatable', resolvedParagraphIndex: null, note: '引文为空' };
  }

  const claimed = input.paragraphs.find(
    (paragraph) => paragraph.index === input.item.paragraphIndex
  );
  if (claimed && normalizeForAnchor(claimed.text).includes(normalizedQuote)) {
    return { outcome: 'exact', resolvedParagraphIndex: claimed.index };
  }

  if (normalizedQuote.length < AUTO_LOOP_MIN_QUOTE_CHARS) {
    return {
      outcome: 'unlocatable',
      resolvedParagraphIndex: null,
      note: `引文过短（不足 ${AUTO_LOOP_MIN_QUOTE_CHARS} 字），不做模糊挽救`,
    };
  }

  const matches = input.paragraphs.filter((paragraph) =>
    normalizeForAnchor(paragraph.text).includes(normalizedQuote)
  );
  if (matches.length === 1) {
    return {
      outcome: 'relocated',
      resolvedParagraphIndex: matches[0].index,
      note: `编号 ${input.item.paragraphIndex} 与引文不符，按引文改定位到第 ${matches[0].index} 段`,
    };
  }

  return {
    outcome: 'unlocatable',
    resolvedParagraphIndex: null,
    note:
      matches.length === 0
        ? '引文在全章未匹配到段落'
        : `引文匹配到 ${matches.length} 个段落，无法唯一定位`,
  };
}

// ---------------------------------------------------------------------------
// 命中上限与同段合并
// ---------------------------------------------------------------------------

/**
 * 单轮命中段落上限。不设上限时模型可能命中全部段落，
 * 等于绕回整章重写并丢掉局部编辑的全部收益。
 */
export function resolveAutoLoopHitCap(totalParagraphs: number): number {
  const scaled = Math.floor(Math.max(0, totalParagraphs) * AUTO_LOOP_HIT_RATIO);
  return Math.min(AUTO_LOOP_HIT_CEILING, Math.max(AUTO_LOOP_HIT_FLOOR, scaled));
}

export interface AutoLoopTarget {
  paragraphIndex: number;
  items: ChapterAutoLoopItem[];
}

export interface AutoLoopSelection {
  targets: AutoLoopTarget[];
  deferred: ChapterAutoLoopItem[];
  unlocatable: ChapterAutoLoopItem[];
}

/**
 * 定位 → 同段合并 → 按严重度截断。
 *
 * 合并发生在截断之前，因为上限是「段落数」而非「条目数」；
 * 同段多条必须并成一次改写，否则后一条会覆盖前一条的结果。
 */
export function selectAutoLoopTargets(input: {
  items: ChapterAutoLoopItem[];
  paragraphs: IndexedParagraph[];
}): AutoLoopSelection {
  const unlocatable: ChapterAutoLoopItem[] = [];
  const grouped = new Map<number, ChapterAutoLoopItem[]>();

  input.items.forEach((item) => {
    const anchor = resolveItemAnchor({ item, paragraphs: input.paragraphs });
    if (anchor.outcome === 'unlocatable' || anchor.resolvedParagraphIndex === null) {
      unlocatable.push({
        ...item,
        status: 'skipped_unlocatable',
        resolvedParagraphIndex: undefined,
        note: anchor.note,
      });
      return;
    }
    const resolved: ChapterAutoLoopItem = {
      ...item,
      status: anchor.outcome === 'relocated' ? 'relocated' : 'pending',
      resolvedParagraphIndex: anchor.resolvedParagraphIndex,
      note: anchor.note ?? item.note,
    };
    const bucket = grouped.get(anchor.resolvedParagraphIndex);
    if (bucket) {
      bucket.push(resolved);
    } else {
      grouped.set(anchor.resolvedParagraphIndex, [resolved]);
    }
  });

  const groups: AutoLoopTarget[] = Array.from(grouped.entries())
    .map(([paragraphIndex, items]) => ({ paragraphIndex, items }))
    .sort((left, right) => {
      const leftRank = Math.max(...left.items.map((item) => SEVERITY_RANK[item.severity]));
      const rightRank = Math.max(...right.items.map((item) => SEVERITY_RANK[item.severity]));
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return left.paragraphIndex - right.paragraphIndex;
    });

  const cap = resolveAutoLoopHitCap(input.paragraphs.length);
  const selected = groups.slice(0, cap);
  const deferred = groups.slice(cap).flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      status: 'deferred' as ChapterAutoLoopItemStatus,
      note: `本轮命中段落已达上限 ${cap} 段，顺延到下一轮`,
    }))
  );

  return {
    targets: selected.sort((left, right) => left.paragraphIndex - right.paragraphIndex),
    deferred,
    unlocatable,
  };
}

// ---------------------------------------------------------------------------
// 分层闸门
// ---------------------------------------------------------------------------

export interface AutoLoopGateResult {
  ok: boolean;
  reason?: string;
}

const MARKDOWN_PATTERN = /```|^#{1,6}\s/mu;
const EXPLANATORY_OPENING_PATTERN =
  /^\s*(以下是|以下为|下面是|下面为|修改后|优化后|改写后|润色后|这是|已按|已根据|根据(?:您|你)的)/u;

/**
 * 段级闸门。失败只回滚该段，不拖累同轮其他段落。
 *
 * 局部编辑让「未命中段落被改动」的风险归零，风险因此换成了
 * 替换段吐说明文字 / Markdown、以及单段字数失控。
 */
export function validateAutoLoopSegment(input: {
  originalText: string;
  replacementText: string;
}): AutoLoopGateResult {
  const original = input.originalText.trim();
  const replacement = input.replacementText.trim();

  if (!replacement) {
    return { ok: false, reason: '替换段为空' };
  }
  if (MARKDOWN_PATTERN.test(replacement)) {
    return { ok: false, reason: '替换段含 Markdown 包裹或标题' };
  }
  if (EXPLANATORY_OPENING_PATTERN.test(replacement)) {
    return { ok: false, reason: '替换段以说明性文字开头' };
  }
  const placeholder = detectPlaceholderText(replacement);
  if (placeholder) {
    return { ok: false, reason: `替换段含占位语（${placeholder}）` };
  }

  if (original.length > 0) {
    const minLength = Math.floor(original.length * SEGMENT_MIN_RATIO);
    const maxLength = Math.ceil(original.length * SEGMENT_MAX_RATIO);
    if (replacement.length < minLength) {
      return {
        ok: false,
        reason: `替换段字数 ${replacement.length} 过短（原段 ${original.length} 字，下限 ${minLength}）`,
      };
    }
    if (replacement.length > maxLength) {
      return {
        ok: false,
        reason: `替换段字数 ${replacement.length} 过长（原段 ${original.length} 字，上限 ${maxLength}）`,
      };
    }
  }

  return { ok: true };
}

export interface AutoLoopRoundGateResult extends AutoLoopGateResult {
  ratio: number;
}

/**
 * 章级闸门。基准始终是**入库原文**而非上一轮成稿，
 * 否则每轮各涨 20% 会轮轮"合规"却累积漂移。
 */
export function validateAutoLoopRound(input: {
  storedContent: string;
  roundDraft: string;
  instruction: string;
}): AutoLoopRoundGateResult {
  const stored = input.storedContent.trim();
  const draft = input.roundDraft.trim();

  if (!draft) {
    return { ok: false, reason: '本轮成稿为空', ratio: 0 };
  }
  if (!stored) {
    return { ok: true, ratio: 1 };
  }

  const ratio = draft.length / stored.length;
  const allowReduction = planAllowsContentReduction(input.instruction);
  const minRatio = allowReduction ? ROUND_MIN_RATIO_WHEN_REDUCTION_ALLOWED : ROUND_MIN_RATIO;

  if (ratio > ROUND_MAX_RATIO) {
    return {
      ok: false,
      ratio,
      reason: `本轮成稿字数为入库原文的 ${Math.round(ratio * 100)}%，超出上限 ${Math.round(
        ROUND_MAX_RATIO * 100
      )}%`,
    };
  }
  if (ratio < minRatio) {
    return {
      ok: false,
      ratio,
      reason: `本轮成稿字数为入库原文的 ${Math.round(ratio * 100)}%，低于下限 ${Math.round(
        minRatio * 100
      )}%`,
    };
  }
  return { ok: true, ratio };
}

// ---------------------------------------------------------------------------
// 轮数与收敛
// ---------------------------------------------------------------------------

export function clampAutoLoopRoundBudget(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return AUTO_LOOP_ROUND_DEFAULT;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return AUTO_LOOP_ROUND_DEFAULT;
  }
  return Math.min(AUTO_LOOP_ROUND_MAX, Math.max(AUTO_LOOP_ROUND_MIN, Math.round(numeric)));
}

export interface AutoLoopContinueDecision {
  shouldContinue: boolean;
  converged: boolean;
}

/**
 * 收敛判定：本轮无 `high` 条目即停。
 *
 * 轮数上限始终是硬上界——复诊与改写是同一模型，
 * 它对自己刚写的东西的严重度自评不完全可信。
 */
export function shouldContinueAutoLoop(input: {
  roundIndex: number;
  roundBudget: number;
  items: Pick<ChapterAutoLoopItem, 'severity'>[];
}): AutoLoopContinueDecision {
  const hasHigh = input.items.some((item) => item.severity === 'high');
  return {
    shouldContinue: hasHigh && input.roundIndex < input.roundBudget,
    converged: !hasHigh,
  };
}

// ---------------------------------------------------------------------------
// System prompts（三处同步的运行时种子）
// ---------------------------------------------------------------------------

export const CHAPTER_AUTO_LOOP_PLAN_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对一段带编号的章节正文做定位式复诊。',
  'ONLY：诊断并输出可机器定位的结构化条目；禁止输出任何章节正文、方案散文或 Markdown。',
  '只输出 JSON：{"items":[{"id":"r1","paragraphIndex":3,"anchorQuote":"原文摘录","severity":"high|medium|low","issue":"问题","instruction":"改写指令"}]}',
  '硬约束：',
  '1) `paragraphIndex` 必须照抄正文中 [n] 的编号，不要自己数段；',
  '2) `anchorQuote` 必须是该段中连续出现的原文片段，至少 8 字，不得改写、不得跨段拼接；',
  '3) `instruction` 必须具体到可直接执行（写什么、删什么、换成什么），禁止「加强描写」这类空泛表述；',
  '4) `severity` 只在真正损害阅读体验时给 high；文字已达可读水准时不要为凑数给 high；',
  '5) 每条只针对一个段落；同一段落的多个问题可分多条；',
  '6) 若正文已充分满足【优化要求】，返回 {"items":[]}，不要编造问题。',
  '若提供了 <previous-items>，须优先指出上一轮未落实或改写后新引入的问题，不得重复已落实条目。',
].join('\n');

export const CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按编辑意见改写章节中的**单个段落**。',
  'ONLY：输出该段落改写后的正文；禁止输出编号、说明、方案、Markdown 或代码块包裹。',
  '硬约束：',
  '1) 只改写 <target-paragraph> 中的内容，不得改写、不得复述 <previous-paragraph> 与 <next-paragraph>；',
  '2) 邻段仅用于把握衔接与人称时态，不得把邻段文字并入输出；',
  '3) 必须逐条落实 <edit-items> 中的指令，不得另起方案、不得扩写到其他情节；',
  '4) 保持剧情事实、对白含义、人物关系与出场人物不变；',
  '5) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
  '6) 语言、人称、时态、人物名称必须与原文一致；',
  '7) 字数应与原段相当，允许合理增减但不得成倍膨胀或大幅删减；',
  '8) 若该段确实无需改动，原样输出该段原文。',
  '允许把一个过长段落拆成语义连贯的多个自然段（用空行分隔），但不得把内容并入邻段。',
].join('\n');

// ---------------------------------------------------------------------------
// 提示拼装
// ---------------------------------------------------------------------------

const ITEM_STATUS_LABELS: Record<ChapterAutoLoopItemStatus, string> = {
  pending: '待处理',
  applied: '已落实',
  relocated: '已重定位并落实',
  skipped_unlocatable: '未能定位已跳过',
  deferred: '因超上限顺延',
  rolled_back: '改写不合规已回滚',
  failed: '改写失败',
};

export function buildAutoLoopPlanUserPrompt(input: {
  instruction: string;
  chapterNo: number;
  chapterTitle: string;
  indexedBody: string;
  roundIndex: number;
  roundBudget: number;
  previousItems?: ChapterAutoLoopItem[];
  narrativeContext?: string;
  personaBlock?: string;
}): string {
  const sections: string[] = [];

  sections.push(
    `【本轮】第 ${input.roundIndex} / ${input.roundBudget} 轮复诊${
      input.roundIndex > 1 ? '（诊断对象是上一轮改写后的最新稿）' : ''
    }`
  );
  sections.push(`【优化要求】\n${input.instruction.trim()}`);
  sections.push(`【章节】第 ${input.chapterNo} 章《${input.chapterTitle}》`);

  if (input.personaBlock?.trim()) {
    sections.push(`【人物卡】\n${input.personaBlock.trim()}`);
  }
  if (input.narrativeContext?.trim()) {
    sections.push(`【叙事上下文】\n${input.narrativeContext.trim()}`);
  }

  const previousItems = input.previousItems ?? [];
  if (previousItems.length > 0) {
    const lines = previousItems.map(
      (item) =>
        `- [${ITEM_STATUS_LABELS[item.status]}] 第 ${
          item.resolvedParagraphIndex ?? item.paragraphIndex
        } 段（${item.severity}）：${item.instruction}`
    );
    sections.push(
      [
        '<previous-items>',
        '上一轮提出的条目及其最终状态。请优先关注未落实的条目，以及改写后新引入的问题。',
        lines.join('\n'),
        '</previous-items>',
      ].join('\n')
    );
  }

  sections.push(`<indexed-chapter>\n${input.indexedBody}\n</indexed-chapter>`);
  sections.push(
    '请只输出 JSON 条目。每条的 paragraphIndex 必须照抄上方 [n] 编号，anchorQuote 必须是该段原文的连续摘录。'
  );

  return sections.join('\n\n');
}

export function buildAutoLoopSegmentUserPrompt(input: {
  instruction: string;
  paragraphIndex: number;
  originalParagraph: string;
  items: ChapterAutoLoopItem[];
  previousParagraph?: string;
  nextParagraph?: string;
  personaBlock?: string;
}): string {
  const sections: string[] = [];

  sections.push(`【优化要求】\n${input.instruction.trim()}`);
  if (input.personaBlock?.trim()) {
    sections.push(`【人物卡】\n${input.personaBlock.trim()}`);
  }

  const itemLines = input.items.map(
    (item, position) =>
      `${position + 1}. （${item.severity}）${item.issue ? `${item.issue} → ` : ''}${item.instruction}`
  );
  sections.push(`<edit-items>\n${itemLines.join('\n')}\n</edit-items>`);

  if (input.previousParagraph?.trim()) {
    sections.push(`<previous-paragraph>\n${input.previousParagraph.trim()}\n</previous-paragraph>`);
  }
  sections.push(
    `<target-paragraph index="${input.paragraphIndex}">\n${input.originalParagraph.trim()}\n</target-paragraph>`
  );
  if (input.nextParagraph?.trim()) {
    sections.push(`<next-paragraph>\n${input.nextParagraph.trim()}\n</next-paragraph>`);
  }

  sections.push('只输出 <target-paragraph> 改写后的正文，不要输出编号、标签、说明或邻段内容。');

  return sections.join('\n\n');
}

export function describeAutoLoopItemStatus(status: ChapterAutoLoopItemStatus): string {
  return ITEM_STATUS_LABELS[status];
}

/**
 * 单段改写的 token 预算。
 *
 * 按原段长度定预算而非给整章额度：一段的合法输出上界是原段的 2.5 倍
 * （见 `validateAutoLoopSegment`），给足整章额度只会让模型有空间越过段级闸门。
 */
export function resolveAutoLoopSegmentMaxTokens(originalParagraph: string): number {
  const estimated = Math.ceil(originalParagraph.length * SEGMENT_TOKENS_PER_CHAR);
  return Math.min(SEGMENT_MAX_MAX_TOKENS, Math.max(SEGMENT_MIN_MAX_TOKENS, estimated));
}

export interface AutoLoopPersonaLike {
  name: string;
  profile: string;
  state: string;
}

/**
 * 出场人物卡文本块。按名字精确过滤，未匹配到就返回空串，
 * 让 prompt 里干脆没有【人物卡】小节，而不是留一个空标题误导模型。
 */
export function formatAutoLoopPersonaBlock(
  personas: AutoLoopPersonaLike[],
  appearingCharacters: string[] | undefined
): string {
  const names = new Set((appearingCharacters ?? []).map((name) => name.trim()).filter(Boolean));
  if (names.size === 0) {
    return '';
  }
  return personas
    .filter((persona) => names.has(persona.name))
    .map((persona) => `${persona.name}：${persona.profile}\n状态：${persona.state}`)
    .join('\n\n');
}
