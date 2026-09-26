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

import { detectPlaceholderText } from './chapter-optimize.util';

export const CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY = 'chapter.optimize.loop.plan';
export const CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY = 'chapter.optimize.loop.draft';

export const AUTO_LOOP_ROUND_MIN = 1;
export const AUTO_LOOP_ROUND_MAX = 5;
export const AUTO_LOOP_ROUND_DEFAULT = 2;

/** 单轮命中段落数上限的比例；用 floor 保守取整，避免小章节被整章覆盖 */
const AUTO_LOOP_HIT_RATIO = 0.35;
const AUTO_LOOP_HIT_FLOOR = 3;
const AUTO_LOOP_HIT_CEILING = 12;

/** 引文短于此长度时不做模糊挽救：太短会匹配到大量段落，救回反而更危险 */
const AUTO_LOOP_MIN_QUOTE_CHARS = 6;

/** 章级只守下限，防止整章被悄悄删空。上限不设——用户明确要扩写。 */
/** 正文丢失兜底：低于此比例视为链路故障，而非合法删减 */
const ROUND_COLLAPSE_RATIO = 0.2;

/** 段级 max_tokens。短段也要给够扩写空间，不再按原段 2.5 倍卡死 */
const SEGMENT_MIN_MAX_TOKENS = 1200;
const SEGMENT_MAX_MAX_TOKENS = 4000;
const SEGMENT_TOKENS_PER_CHAR = 8;

export type ChapterAutoLoopSeverity = 'high' | 'medium' | 'low';

export type ChapterAutoLoopItemStatus =
  | 'pending'
  | 'applied'
  | 'relocated'
  | 'deleted'
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
  /** 对应改写调用的实验室快照，便于入口直达而不靠窗/轮/段反查 */
  promptLabCallId?: string;
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

/** 按原始分隔串拼回；`overrides` 中的段落用替换文本，`deleted` 中的槽位连同其后分隔串一起抽掉。 */
export function joinIndexedParagraphs(
  indexed: IndexedParagraphs,
  overrides?: Map<number, string>,
  deleted?: Set<number>
): string {
  let output = indexed.prefix;
  indexed.paragraphs.forEach((paragraph) => {
    if (deleted?.has(paragraph.index)) {
      return;
    }
    output += overrides?.get(paragraph.index) ?? paragraph.text;
    output += paragraph.separator;
  });
  return output + indexed.suffix;
}

export interface ParagraphReplacement {
  paragraphIndex: number;
  text: string;
  /** 抽掉该槽位（含其后分隔串），使前后段直接衔接 */
  deleteParagraph?: boolean;
}

/**
 * 只替换命中段落。越界编号与空替换被忽略，
 * 因此未命中段落在结果中与输入逐字节相同。
 * `deleteParagraph` 抽槽，不是空替换——空替换仍会被忽略以免误删。
 */
export function applyParagraphReplacements(
  indexed: IndexedParagraphs,
  replacements: ParagraphReplacement[]
): string {
  const overrides = new Map<number, string>();
  const deleted = new Set<number>();
  const maxIndex = indexed.paragraphs.length;
  replacements.forEach((replacement) => {
    if (replacement.paragraphIndex < 1 || replacement.paragraphIndex > maxIndex) {
      return;
    }
    if (replacement.deleteParagraph) {
      deleted.add(replacement.paragraphIndex);
      return;
    }
    const text = replacement.text.trim();
    if (!text) {
      return;
    }
    overrides.set(replacement.paragraphIndex, text);
  });
  return joinIndexedParagraphs(indexed, overrides, deleted);
}

/** 上一窗只读前文：超过该字数则截末尾，避免把整窗塞进下一窗复诊 */
export const AUTO_LOOP_WINDOW_TAIL_CHARS = 400;

/** 改写时只读前文/后文各约两千字，够判断前后发生了什么 */
export const AUTO_LOOP_PRECEDING_CHARS = 2000;
export const AUTO_LOOP_FOLLOWING_CHARS = 2000;

export interface AutoLoopCharWindow {
  /** 该窗正文（不含窗后分隔串；末窗含 suffix） */
  text: string;
  /** 拼回时紧跟在本窗成稿之后的原始分隔串；末窗为空 */
  joinAfter: string;
}

/**
 * 按空行段落 greedy 攒窗。不腰斩；单段超过预算则整段单独成窗。
 * `segmentCharSize === 0` 或章节未过 `singleSegmentThreshold` 时整章一窗。
 * `stitchAutoLoopCharWindows(windows, [])` 必须逐字节等于 `source`。
 */
export function splitAutoLoopCharWindows(
  source: string,
  options: { segmentCharSize: number; singleSegmentThreshold: number }
): AutoLoopCharWindow[] {
  const indexed = splitIndexedParagraphs(source);
  if (
    indexed.paragraphs.length === 0 ||
    options.segmentCharSize === 0 ||
    source.length <= options.singleSegmentThreshold
  ) {
    return [{ text: source, joinAfter: '' }];
  }

  const windows: AutoLoopCharWindow[] = [];
  const paragraphs = indexed.paragraphs;
  let start = 0;
  while (start < paragraphs.length) {
    let end = start;
    let chars = paragraphs[start].text.length;
    while (end + 1 < paragraphs.length) {
      const nextChars = paragraphs[end + 1].text.length;
      if (chars + nextChars > options.segmentCharSize) {
        break;
      }
      end += 1;
      chars += nextChars;
    }

    const isFirst = start === 0;
    const isLast = end === paragraphs.length - 1;
    let text = isFirst ? indexed.prefix : '';
    for (let index = start; index <= end; index += 1) {
      text += paragraphs[index].text;
      if (index < end) {
        text += paragraphs[index].separator;
      }
    }
    if (isLast) {
      text += paragraphs[end].separator + indexed.suffix;
    }
    windows.push({
      text,
      joinAfter: isLast ? '' : paragraphs[end].separator,
    });
    start = end + 1;
  }
  return windows;
}

/** `drafts[i]` 缺省时回落到该窗原文，用于拼回未跑/未改的尾窗 */
export function stitchAutoLoopCharWindows(
  windows: AutoLoopCharWindow[],
  drafts: Array<string | undefined>
): string {
  return windows
    .map((window, index) => `${drafts[index] ?? window.text}${window.joinAfter}`)
    .join('');
}

/**
 * 目标段之前的原文。从最近邻段往前攒，超预算时保留靠近目标段的末尾。
 */
export function extractAutoLoopPrecedingText(
  paragraphs: IndexedParagraph[],
  beforeIndex: number,
  maxChars = AUTO_LOOP_PRECEDING_CHARS
): string {
  const preceding = paragraphs.filter((paragraph) => paragraph.index < beforeIndex);
  if (preceding.length === 0 || maxChars <= 0) {
    return '';
  }
  let text = '';
  for (let index = preceding.length - 1; index >= 0; index -= 1) {
    const piece = preceding[index].text;
    if (!text && piece.length > maxChars) {
      return piece.slice(-maxChars);
    }
    const next = text ? `${piece}\n\n${text}` : piece;
    if (text && next.length > maxChars) {
      break;
    }
    text = next;
    if (text.length >= maxChars) {
      break;
    }
  }
  return text;
}

/**
 * 目标段之后的原文，供改写避让后文情节。按段累加到预算；首段超预算则截断。
 */
export function extractAutoLoopFollowingText(
  paragraphs: IndexedParagraph[],
  afterIndex: number,
  maxChars = AUTO_LOOP_FOLLOWING_CHARS
): string {
  const following = paragraphs.filter((paragraph) => paragraph.index > afterIndex);
  if (following.length === 0 || maxChars <= 0) {
    return '';
  }
  let text = '';
  for (const paragraph of following) {
    const piece = paragraph.text;
    if (!text && piece.length > maxChars) {
      return piece.slice(0, maxChars);
    }
    const next = text ? `${text}\n\n${piece}` : piece;
    if (text && next.length > maxChars) {
      break;
    }
    text = next;
    if (text.length >= maxChars) {
      break;
    }
  }
  return text;
}

export function extractAutoLoopWindowTail(
  text: string,
  maxChars = AUTO_LOOP_WINDOW_TAIL_CHARS
): string {
  const last = splitIndexedParagraphs(text).paragraphs.at(-1);
  if (!last) {
    return '';
  }
  if (last.text.length <= maxChars) {
    return last.text;
  }
  return last.text.slice(-maxChars);
}

export interface MergeIntoNeighborPair {
  sourceIndex: number;
  keeperIndex: number;
}

/**
 * 从 instruction 解析「删源段 + 内容并入保留段」。
 * 支持「整合进[312]」「并入第2段」「将118段与117段合并」等写法。
 */
export function parseMergeIntoNeighborPair(instruction: string): MergeIntoNeighborPair | null {
  const text = instruction.replace(/\s+/g, '');
  if (!text || /(?:不要|禁止|勿|别).{0,12}(?:合并|并入|整合)/.test(text)) {
    return null;
  }

  const numberedPair =
    text.match(/(?:将|把)(?:第|\[)?(\d+)\]?段与(?:第|\[)?(\d+)\]?段合并/) ??
    text.match(/(?:将|把)(?:第|\[)?(\d+)\]?段(?:合并到|并入|整合进|整合到)(?:第|\[)?(\d+)\]?段/);
  if (numberedPair) {
    const sourceIndex = Number(numberedPair[1]);
    const keeperIndex = Number(numberedPair[2]);
    if (sourceIndex !== keeperIndex) {
      return { sourceIndex, keeperIndex };
    }
  }

  const integrateKeeper =
    text.match(/(?:整合进|整合到|并入|合并到)\[(\d+)\]/) ??
    text.match(/(?:整合进|整合到|并入|合并到)(?:第)?(\d+)段/);
  const deleteSource =
    text.match(/(?:删除|删掉|去掉)\[(\d+)\]/) ??
    text.match(/(?:删除|删掉|去掉)(?:第)?(\d+)段/);
  if (integrateKeeper && deleteSource) {
    const keeperIndex = Number(integrateKeeper[1]);
    const sourceIndex = Number(deleteSource[1]);
    if (sourceIndex !== keeperIndex) {
      return { sourceIndex, keeperIndex };
    }
  }

  const keeperOnly =
    text.match(/(?:第)?(\d+)段保留/) ??
    text.match(/保留(?:第)?(\d+)段/) ??
    text.match(/(?:并入|合并到|整合进|整合到)(?:第)?(\d+)段/) ??
    text.match(/与(?:第)?(\d+)段合并/);
  if (keeperOnly && deleteSource) {
    const keeperIndex = Number(keeperOnly[1]);
    const sourceIndex = Number(deleteSource[1]);
    if (sourceIndex !== keeperIndex) {
      return { sourceIndex, keeperIndex };
    }
  }

  return null;
}

/**
 * 「将118段与117段合并」类指令：源段抽槽，保留段不抽。
 * 挂在保留段上时必须走改写，避免误删已写好的邻段。
 */
function isMergeIntoNeighborDeletion(text: string, paragraphIndex?: number): boolean {
  const pair = parseMergeIntoNeighborPair(text);
  if (pair) {
    if (paragraphIndex == null) {
      return true;
    }
    return paragraphIndex === pair.sourceIndex && paragraphIndex !== pair.keeperIndex;
  }

  const compact = text.replace(/\s+/g, '');
  if (/(?:不要|禁止|勿|别).{0,12}(?:合并|并入|整合)/.test(compact)) {
    return false;
  }
  if (/(?:将|把)(?:本段|该段|此段)/.test(compact) && /(?:合并|并入|整合)/.test(compact)) {
    return true;
  }
  if (/(?:并入|合并到|整合进|整合到|与)(?:上一段|前一段|下一段|后一段|邻段)/.test(compact)) {
    return true;
  }
  return paragraphIndex != null && /两段合并/.test(compact);
}

/** 合并对源段删除任务：须等保留段改写成功后再抽槽 */
export function mergeDeleteDependsOnKeeper(
  items: Array<{ instruction: string }>,
  paragraphIndex: number
): number | undefined {
  for (const item of items) {
    if (!shouldExpandMergeToKeeperRewrite(item.instruction)) {
      continue;
    }
    const pair = parseMergeIntoNeighborPair(item.instruction);
    if (pair && pair.sourceIndex === paragraphIndex) {
      return pair.keeperIndex;
    }
  }
  return undefined;
}

/** instruction 里点名要删的段号；未点名则任何槽位都算。 */
function numberedDeleteTarget(text: string): number | undefined {
  const match = text.match(/(?:删除|删掉|去掉)(?:\[(\d+)\]|第?(\d+)段)/);
  if (!match) {
    return undefined;
  }
  return Number(match[1] || match[2]);
}

function numberedDeleteMatchesSlot(text: string, paragraphIndex?: number): boolean {
  if (paragraphIndex == null) {
    return true;
  }
  const target = numberedDeleteTarget(text);
  return target == null || target === paragraphIndex;
}

/**
 * 整段/整句删除。刻意收窄：
 * 「删除这句里的成语」不算；「删除[183]整句」「删除第36段整段」才算。
 * 复诊若写成「与邻段合并」，挂在被并掉的源段上也按抽槽处理，避免改写交空。
 */
export function isWholeParagraphDeletion(
  instruction: string,
  paragraphIndex?: number
): boolean {
  const text = instruction.replace(/\s+/g, '');
  if (!text) {
    return false;
  }
  if (/(?:整段|整句)删除/.test(text)) {
    return numberedDeleteMatchesSlot(text, paragraphIndex);
  }
  if (/(?:去掉|删掉)(?:整段|整句|此句|该句|该段|本段)/.test(text)) {
    return numberedDeleteMatchesSlot(text, paragraphIndex);
  }
  if (
    /(?:删除|删掉|去掉)(?:\[[0-9]+\]|第?\d+段|本段|该段)?(?:整段|整句|此句|该句|该段|本段|这一段|这一句)(?![中里内的])/.test(
      text
    )
  ) {
    return numberedDeleteMatchesSlot(text, paragraphIndex);
  }
  if (/(?:删除|删掉|去掉)第?\d+段(?![中里内的]|的)/.test(text)) {
    return numberedDeleteMatchesSlot(text, paragraphIndex);
  }
  return isMergeIntoNeighborDeletion(text, paragraphIndex);
}

/** 该命中段上的条目全部都是整段删除时，走抽槽而不是改写。 */
export function isDeleteOnlyTarget(
  items: Array<{ instruction: string }>,
  paragraphIndex?: number
): boolean {
  return (
    items.length > 0 &&
    items.every((item) => isWholeParagraphDeletion(item.instruction, paragraphIndex))
  );
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
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|JSON)?\s*/u, '')
    .replace(/```$/u, '')
    .trim();
}

function repairTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1');
}

/** 只修键名两侧的弯引号（{“items”:），绝不改字符串内容里的「“像被电了一下”」。 */
function replaceStructuralCurlyQuotes(text: string): string {
  return text
    .replace(/(\{|\[|,)(\s*)[\u201c\u201d]/g, '$1$2"')
    .replace(/[\u201c\u201d](\s*:)/g, '"$1');
}

/**
 * 模型偶发漏掉字符串收尾引号：`"id":"r9,"paragraphIndex":142`
 * 会被读成 `"r9,"` 后直接撞上下一个键，整份 JSON.parse 一起死。
 * 只修「值未闭合 + 下一键名」这一种模式，不碰正文里的合法逗号。
 */
function repairDroppedStringClosures(text: string): string {
  return text.replace(/(:\s*")([^"\n\r]*?),"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, ':"$2","$3":');
}

function tryParseJson(text: string): unknown {
  const repaired = repairDroppedStringClosures(text);
  for (const candidate of [
    text,
    repaired,
    repairTrailingCommas(text),
    repairTrailingCommas(repaired),
    replaceStructuralCurlyQuotes(text),
    replaceStructuralCurlyQuotes(repaired),
    replaceStructuralCurlyQuotes(repairTrailingCommas(text)),
    replaceStructuralCurlyQuotes(repairTrailingCommas(repaired)),
  ]) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractBalanced(
  text: string,
  startIndex: number,
  open: '{' | '[',
  close: '}' | ']'
): string | null {
  if (text[startIndex] !== open) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }
  return null;
}

const ITEM_ARRAY_KEYS = ['items', 'issues', 'diagnostics', 'findings', 'entries', 'problems'];

function collectRawItems(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ITEM_ARRAY_KEYS) {
    if (Array.isArray(record[key])) {
      return record[key];
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const nested = collectRawItems(value);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function looksLikeItemRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.paragraphIndex !== undefined ||
    record.paragraph_index !== undefined ||
    record.paragraph !== undefined ||
    record.anchorQuote !== undefined ||
    record.quote !== undefined ||
    record.instruction !== undefined ||
    record.issue !== undefined
  );
}

function extractLooseItemRecords(raw: string): unknown[] {
  const records: unknown[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf('{', cursor);
    if (start < 0) {
      break;
    }
    const slice = extractBalanced(raw, start, '{', '}');
    if (!slice) {
      cursor = start + 1;
      continue;
    }
    const parsed = tryParseJson(slice);
    if (parsed && typeof parsed === 'object') {
      const asItems = collectRawItems(parsed);
      if (asItems && asItems !== parsed) {
        return asItems;
      }
      if (looksLikeItemRecord(parsed)) {
        records.push(parsed);
      }
      cursor = start + slice.length;
      continue;
    }
    // 外层 {items:[...]} 括号配得上但内部有脏字段时，不能整坨跳过，
    // 否则里面其余合法条目会一起被扔掉。
    cursor = start + 1;
  }
  return records;
}

function extractJsonObject(raw: string): unknown {
  const stripped = stripCodeFence(raw);
  const candidates: string[] = [stripped];

  const itemsKey = stripped.search(/\{\s*["'\u201c\u201d]items["'\u201c\u201d]/);
  const firstBrace = stripped.indexOf('{');
  const braceStarts = [itemsKey, firstBrace].filter((index) => index >= 0);
  for (const start of braceStarts) {
    const balanced = extractBalanced(stripped, start, '{', '}');
    if (balanced) {
      candidates.push(balanced);
    }
  }

  const firstBracket = stripped.indexOf('[');
  if (firstBracket >= 0) {
    const balanced = extractBalanced(stripped, firstBracket, '[', ']');
    if (balanced) {
      candidates.push(balanced);
    }
  }

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  const loose = extractLooseItemRecords(stripped);
  if (loose.length > 0) {
    return { items: loose };
  }
  return undefined;
}

/**
 * severity 归一化。
 *
 * 模型在中文 prompt 下经常回中文档位或大写英文；严格比字符串会让整轮诊断
 * 归零，而这类偏差与诊断质量无关，属于纯格式抖动，值得容忍。
 */
const SEVERITY_ALIASES: Record<string, ChapterAutoLoopSeverity> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
  严重: 'high',
  高: 'high',
  重要: 'high',
  高危: 'high',
  关键: 'high',
  致命: 'high',
  urgent: 'high',
  critical: 'high',
  major: 'high',
  中等: 'medium',
  中: 'medium',
  一般: 'medium',
  普通: 'medium',
  normal: 'medium',
  轻微: 'low',
  低: 'low',
  次要: 'low',
  minor: 'low',
  trivial: 'low',
};

function normalizeSeverity(value: unknown): ChapterAutoLoopSeverity | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 3) {
      return 'high';
    }
    if (value <= 1) {
      return 'low';
    }
    return 'medium';
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return SEVERITY_ALIASES[trimmed] ?? null;
}

function resolveItemSeverity(record: Record<string, unknown>): ChapterAutoLoopSeverity {
  return (
    normalizeSeverity(record.severity) ??
    normalizeSeverity(record.level) ??
    normalizeSeverity(record.priority) ??
    'medium'
  );
}

/** 取第一个非空字符串字段，用于容忍 `quote` / `suggestion` 这类同义键名。 */
function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseParagraphIndexValue(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  const trimmed = value.trim();
  const direct = Number(trimmed);
  if (Number.isInteger(direct) && direct >= 1) {
    return direct;
  }
  const match = trimmed.match(/(\d+)/);
  if (!match) {
    return Number.NaN;
  }
  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric >= 1 ? numeric : Number.NaN;
}

function pickParagraphIndex(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (record[key] === undefined || record[key] === null) {
      continue;
    }
    const numeric = parseParagraphIndexValue(record[key]);
    if (Number.isInteger(numeric)) {
      return numeric;
    }
  }
  return Number.NaN;
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
    const paragraphIndex = pickParagraphIndex(record, [
      'paragraphIndex',
      'paragraph_index',
      'paragraph',
      'paraIndex',
      'index',
      'n',
    ]);
    const anchorQuote = pickString(record, [
      'anchorQuote',
      'anchor_quote',
      'quote',
      'anchor',
      'excerpt',
      'original',
      'snippet',
      'source',
    ]);
    const instruction = pickString(record, [
      'instruction',
      'suggestion',
      'fix',
      'action',
      'edit',
      'rewrite',
      'advice',
      'direction',
      'issue',
      'problem',
    ]);
    const severity = resolveItemSeverity(record);

    // 定位信息（编号 + 引文）与可执行指令是局部改写的硬前提，缺一条都无法安全落地
    if (!Number.isInteger(paragraphIndex) || !anchorQuote || !instruction) {
      discardedCount += 1;
      return;
    }

    const providedId = typeof record.id === 'string' ? record.id.trim() : '';
    items.push({
      id: providedId || `item-${items.length + 1}`,
      paragraphIndex,
      anchorQuote,
      severity,
      issue: pickString(record, ['issue', 'problem', 'reason']),
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
  /** 合并对源段：须等该编号段改写成功后再抽槽 */
  deleteAfterRewriteIndex?: number;
}

export interface AutoLoopSelection {
  targets: AutoLoopTarget[];
  deferred: ChapterAutoLoopItem[];
  unlocatable: ChapterAutoLoopItem[];
}

function quoteFromParagraph(text: string): string {
  const compact = text.replace(/\s+/g, '');
  if (compact.length <= 24) {
    return compact || text.trim();
  }
  return compact.slice(0, 24);
}

function buildKeeperMergeInstruction(sourceInstruction: string, pair: MergeIntoNeighborPair): string {
  const stripped = sourceInstruction
    .replace(/(?:删除|删掉|去掉)\s*(?:\[\d+\]|第?\d+段)?\s*(?:整段|整句|此句|该句|该段|本段)?[，。；]*/g, '')
    .replace(/使\s*(?:\[\d+\]|第?\d+段)\s*直接衔接\s*(?:\[\d+\]|第?\d+段)[，。；]*/g, '')
    .trim();
  const detail = stripped || sourceInstruction.trim();
  return `将原第 ${pair.sourceIndex} 段需保留的细节整合进本段（第 ${pair.keeperIndex} 段）。${detail}`;
}

function shouldExpandMergeToKeeperRewrite(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, '');
  if (!text || /(?:不要|禁止|勿|别).{0,12}(?:整合|并入|合并)/.test(text)) {
    return false;
  }
  // 「将A与B合并、B保留现有」只抽源段；「整合进/并入/合并到」才需要先改写保留段
  if (/(?:整合进|整合到)/.test(text)) {
    return true;
  }
  if (/(?:并入|合并到)(?:\[\d+\]|第?\d+段)/.test(text)) {
    return true;
  }
  if (/将.{0,80}(?:细节|内容|描写|感官).{0,40}(?:整合|写入|并入|融进)/.test(text)) {
    return true;
  }
  return false;
}

/**
 * 把「删[n] + 整合进[m]」拆成两条：保留段改写 + 源段删除。
 * 只挂在源段上的合并指令否则会走抽槽，保留段永远得不到改写。
 * 「将A与B合并、B保留现有」不拆，仍只删源段。
 */
export function expandMergeIntoNeighborItems(
  items: ChapterAutoLoopItem[],
  paragraphs: IndexedParagraph[]
): ChapterAutoLoopItem[] {
  const byParagraph = new Set(
    items.map((item) => item.resolvedParagraphIndex ?? item.paragraphIndex)
  );
  const expanded: ChapterAutoLoopItem[] = [];

  items.forEach((item) => {
    const slot = item.resolvedParagraphIndex ?? item.paragraphIndex;
    const pair = parseMergeIntoNeighborPair(item.instruction);
    if (!pair || pair.sourceIndex !== slot || !shouldExpandMergeToKeeperRewrite(item.instruction)) {
      expanded.push(item);
      return;
    }

    const keeperParagraph = paragraphs.find((entry) => entry.index === pair.keeperIndex);
    const sourceParagraph = paragraphs.find((entry) => entry.index === pair.sourceIndex);
    if (!keeperParagraph || !sourceParagraph) {
      expanded.push(item);
      return;
    }

    if (!byParagraph.has(pair.keeperIndex)) {
      expanded.push({
        ...item,
        id: `${item.id}#keeper`,
        paragraphIndex: pair.keeperIndex,
        resolvedParagraphIndex: pair.keeperIndex,
        anchorQuote: quoteFromParagraph(keeperParagraph.text),
        instruction: buildKeeperMergeInstruction(item.instruction, pair),
        status: 'pending',
        note: `由删除第 ${pair.sourceIndex} 段并整合的指令自动拆出，须先改写本段`,
      });
      byParagraph.add(pair.keeperIndex);
    }

    expanded.push({
      ...item,
      id: item.id.includes('#delete') ? item.id : `${item.id}#delete`,
      paragraphIndex: pair.sourceIndex,
      resolvedParagraphIndex: pair.sourceIndex,
      // 保留原 instruction，供 mergeDeleteDependsOnKeeper 解析保留段编号
      status: 'pending',
      note:
        item.note ??
        `合并对源段：先改写第 ${pair.keeperIndex} 段，成功后再删除本段`,
    });
  });

  return expanded;
}

/** 上一轮因超上限顺延的条目，本轮优先入队（不再只靠模型重新提出）。 */
export function carryDeferredItems(previousItems: ChapterAutoLoopItem[]): ChapterAutoLoopItem[] {
  return previousItems
    .filter((item) => item.status === 'deferred')
    .map((item) => ({
      ...item,
      id: item.id.startsWith('carry:') ? item.id : `carry:${item.id}`,
      status: 'pending' as ChapterAutoLoopItemStatus,
      note: '上一轮超上限顺延，本轮优先处理',
    }));
}

/** 改写段在前、抽槽段在后，保证合并对先写保留段再删源段。 */
export function orderTargetsRewriteBeforeDelete(targets: AutoLoopTarget[]): AutoLoopTarget[] {
  const decorate = (target: AutoLoopTarget): AutoLoopTarget => {
    if (!isDeleteOnlyTarget(target.items, target.paragraphIndex)) {
      return target;
    }
    const dependsOn =
      target.deleteAfterRewriteIndex ??
      mergeDeleteDependsOnKeeper(target.items, target.paragraphIndex);
    return dependsOn == null
      ? target
      : { ...target, deleteAfterRewriteIndex: dependsOn };
  };

  const rewrites = targets
    .filter((target) => !isDeleteOnlyTarget(target.items, target.paragraphIndex))
    .map(decorate)
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex);
  const deletes = targets
    .filter((target) => isDeleteOnlyTarget(target.items, target.paragraphIndex))
    .map(decorate)
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex);
  return [...rewrites, ...deletes];
}

/**
 * 定位 → 合并拆分 → 同段合并 → 按严重度截断。
 *
 * 合并发生在截断之前，因为上限是「段落数」而非「条目数」；
 * 同段多条必须并成一次改写，否则后一条会覆盖前一条的结果。
 * `preferItemIds`（通常为上一轮 deferred 顺延）优先占满命中名额。
 * 最后一轮 `unlimitedHits`：不再截断，避免顺延后无处可去。
 */
export function selectAutoLoopTargets(input: {
  items: ChapterAutoLoopItem[];
  paragraphs: IndexedParagraph[];
  preferItemIds?: ReadonlySet<string>;
  unlimitedHits?: boolean;
}): AutoLoopSelection {
  const unlocatable: ChapterAutoLoopItem[] = [];
  const grouped = new Map<number, ChapterAutoLoopItem[]>();
  const preferItemIds = input.preferItemIds ?? new Set<string>();
  const isPreferredItem = (item: ChapterAutoLoopItem): boolean => {
    if (preferItemIds.has(item.id)) {
      return true;
    }
    for (const id of preferItemIds) {
      if (item.id.startsWith(`${id}#`)) {
        return true;
      }
    }
    return false;
  };
  const expanded = expandMergeIntoNeighborItems(input.items, input.paragraphs);

  expanded.forEach((item) => {
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

  // 合并对占两席：若源段入选则强制带上保留段，避免只删不写
  const ensureMergePairs = () => {
    for (const [paragraphIndex, items] of Array.from(grouped.entries())) {
      const dependsOn = mergeDeleteDependsOnKeeper(items, paragraphIndex);
      if (dependsOn == null || grouped.has(dependsOn)) {
        continue;
      }
      const seed = items[0];
      const keeperParagraph = input.paragraphs.find((entry) => entry.index === dependsOn);
      if (!keeperParagraph || !seed) {
        continue;
      }
      const pair = parseMergeIntoNeighborPair(seed.instruction) ?? {
        sourceIndex: paragraphIndex,
        keeperIndex: dependsOn,
      };
      grouped.set(dependsOn, [
        {
          ...seed,
          id: `${seed.id}#keeper`,
          paragraphIndex: dependsOn,
          resolvedParagraphIndex: dependsOn,
          anchorQuote: quoteFromParagraph(keeperParagraph.text),
          instruction: buildKeeperMergeInstruction(seed.instruction, pair),
          status: 'pending',
          note: `与第 ${paragraphIndex} 段合并对绑定，须同轮改写`,
        },
      ]);
    }
  };
  ensureMergePairs();

  const groups: AutoLoopTarget[] = Array.from(grouped.entries())
    .map(([paragraphIndex, items]) => ({ paragraphIndex, items }))
    .sort((left, right) => {
      const leftPrefer = left.items.some((item) => isPreferredItem(item));
      const rightPrefer = right.items.some((item) => isPreferredItem(item));
      if (leftPrefer !== rightPrefer) {
        return leftPrefer ? -1 : 1;
      }
      const leftRank = Math.max(...left.items.map((item) => SEVERITY_RANK[item.severity]));
      const rightRank = Math.max(...right.items.map((item) => SEVERITY_RANK[item.severity]));
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return left.paragraphIndex - right.paragraphIndex;
    });

  const cap = input.unlimitedHits
    ? groups.length
    : resolveAutoLoopHitCap(input.paragraphs.length);
  let selected = groups.slice(0, cap);
  let overflow = groups.slice(cap);

  // 截断后若合并对被拆开，把缺失的一端从 overflow 拉回（挤掉末位非配对段）
  const selectedIndexes = new Set(selected.map((target) => target.paragraphIndex));
  const missingKeepers: AutoLoopTarget[] = [];
  selected.forEach((target) => {
    if (!isDeleteOnlyTarget(target.items, target.paragraphIndex)) {
      return;
    }
    const keeper = mergeDeleteDependsOnKeeper(target.items, target.paragraphIndex);
    if (keeper == null || selectedIndexes.has(keeper)) {
      return;
    }
    const rescued = overflow.find((group) => group.paragraphIndex === keeper);
    if (rescued) {
      missingKeepers.push(rescued);
      overflow = overflow.filter((group) => group.paragraphIndex !== keeper);
      selectedIndexes.add(keeper);
    }
  });
  if (missingKeepers.length > 0) {
    const room = Math.max(0, cap - selected.length);
    const need = missingKeepers.length - room;
    if (need > 0) {
      const droppable = selected
        .filter((target) => {
          const paired = selected.some(
            (other) =>
              other.paragraphIndex !== target.paragraphIndex &&
              (mergeDeleteDependsOnKeeper(other.items, other.paragraphIndex) ===
                target.paragraphIndex ||
                mergeDeleteDependsOnKeeper(target.items, target.paragraphIndex) ===
                  other.paragraphIndex)
          );
          return !paired && !target.items.some((item) => isPreferredItem(item));
        })
        .slice(-need);
      const dropSet = new Set(droppable.map((target) => target.paragraphIndex));
      overflow = [...droppable, ...overflow];
      selected = selected.filter((target) => !dropSet.has(target.paragraphIndex));
    }
    selected = [...selected, ...missingKeepers].slice(0, cap + missingKeepers.length);
    // 合并对允许短暂超过 cap 1 席，避免只删不写
    if (selected.length > cap + missingKeepers.length) {
      selected = selected.slice(0, cap + missingKeepers.length);
    }
  }

  const deferred = overflow.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      status: 'deferred' as ChapterAutoLoopItemStatus,
      note: `本轮命中段落已达上限 ${cap} 段，顺延到下一轮`,
    }))
  );

  return {
    targets: orderTargetsRewriteBeforeDelete(selected),
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
 * 只拦空输出、说明文字、Markdown 和占位语。字数不设上下限——
 * 扩写是用户明确要求，按原段比例回滚等于把要求挡在门外。
 */
export function validateAutoLoopSegment(input: {
  originalText: string;
  replacementText: string;
}): AutoLoopGateResult {
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

  return { ok: true };
}

export interface AutoLoopRoundGateResult extends AutoLoopGateResult {
  ratio: number;
}

/**
 * 章级闸门。不裁决改动幅度——改多少是用户要求与 prompt 的事。
 *
 * 唯一守住的是数据安全：本轮成稿会覆盖入库正文，若整章被削到几乎不剩，
 * 那是链路故障而非编辑意图，必须拦下以免正文被悄悄清空。
 */
export function validateAutoLoopRound(input: {
  storedContent: string;
  roundDraft: string;
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
  if (ratio < ROUND_COLLAPSE_RATIO) {
    return {
      ok: false,
      ratio,
      reason: `本轮成稿仅为入库正文的 ${Math.round(ratio * 100)}%，疑似链路故障导致正文丢失`,
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
  /** 本轮诊断是否被完整读懂（无条目因格式被丢弃） */
  diagnosisComplete: boolean;
}

/**
 * 收敛判定：本轮仍有 `high` 就继续复诊。
 *
 * medium / low 不再续跑。复诊只允许出「要求明显未落地」或「上轮改坏」，
 * 这两类标 high；把「还能更贴要求」标成 medium 续跑，会变成一直润色。
 * 轮数上限始终是硬上界。
 */
export function shouldContinueAutoLoop(input: {
  roundIndex: number;
  roundBudget: number;
  items: Pick<ChapterAutoLoopItem, 'severity'>[];
  discardedCount?: number;
  /** 保留入参以兼容既有调用；收敛不再依赖本轮是否改写过 */
  appliedCount?: number;
}): AutoLoopContinueDecision {
  const needsMoreWork = input.items.some((item) => item.severity === 'high');
  // 只有把整份诊断都读懂了，「没有 high」才等于可以收工。
  // 有条目被丢弃时，被丢的那条完全可能正是 high/medium。
  const diagnosisComplete = (input.discardedCount ?? 0) === 0;
  const converged = !needsMoreWork && diagnosisComplete;
  return {
    shouldContinue: (needsMoreWork || !diagnosisComplete) && input.roundIndex < input.roundBudget,
    converged,
    diagnosisComplete,
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
  '1) 只允许出两类条目：①【用户优化要求】明显没有落到该段；②上一轮改写改坏了、或新引入的偏离。禁止把项目文风 / systemPrompt /「还能更贴要求」拆成润色条目。',
  '2) `paragraphIndex` 必须照抄正文中 [n] 的编号，不要自己数段；',
  '3) `anchorQuote` 必须是该段中连续出现的原文片段，至少 8 字，不得改写、不得跨段拼接；',
  '4) `instruction` 必须写明该段要补的未落实点或要修的改坏处（写什么、删什么、换成什么），禁止「加强描写」「再润色」这类空泛表述；',
  '5) `severity`：①② 给 high。不要把「部分未落实但仍能读」标成 medium 来续跑。没有 ①② 时不要出条目。',
  '6) 每条只针对一个段落；同一段落的多个问题可分多条；',
  '7) 没有 ①② 两类问题时必须返回 {"items":[]}，不要编造润色项。',
  '8) 若应删掉整段/整句，instruction 必须写明「删除整段」「删除整句」或「删除第n段整段」（可带 [n]），不要改写成空过渡或空输出。',
  '9) 禁止在 instruction 里写「两段合并」「与第 n 段合并」。邻段重复时拆成已支持的条目：只需丢掉多余段时，只出一条挂在被删段，写「删除[n]整句，使[m]直接衔接[p]」；被删段有内容必须写进邻段时，必须出两条——邻段一条改写（整合细节）、被删段一条「删除整段」，且改写条目排在删除之前。若误写成单条「删除[n]…整合进[m]」，运行时会自动拆成先改写[m]再删[n]。未点名的邻段保持原文。',
  '若提供了 <previous-items>，须优先指出上一轮未落实或改写后新引入的问题，不得重复已落实条目，也不得借复诊另开润色清单。',
].join('\n');

export const CHAPTER_AUTO_LOOP_DRAFT_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按编辑意见改写章节中的**单个段落**。',
  'ONLY：输出该段落改写后的正文；禁止输出编号、说明、方案、Markdown 或代码块包裹。',
  '硬约束：',
  '1) 必须遵循【用户优化要求】；<edit-items> 是该要求在本段的落点，不得用条目覆盖或偏离用户要求；',
  '2) 只改写 <target-paragraph> 中的内容，不得改写、不得复述 <preceding-paragraphs> 与 <following-paragraphs>；',
  '3) 前文与后文只读块仅用于判断前后发生了什么、把握衔接，避免扩写抢写后文情节、对白或结果，不得把这些文字并入输出；',
  '4) 必须逐条落实 <edit-items> 中的指令，不得另起方案、不得扩写到其他情节；',
  '5) 保持剧情事实、对白含义、人物关系与出场人物不变；',
  '6) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
  '7) 语言、人称、时态、人物名称必须与原文一致；',
  '8) 允许按【用户优化要求】扩写或收紧，但扩写只加深本段已有动作、感官与情绪，不得把后文情节提前写完；',
  '9) 若该段确实无需改动，原样输出该段原文。',
  '允许把一个过长段落拆成语义连贯的多个自然段（用空行分隔），但不得把内容并入邻段。',
].join('\n');

// ---------------------------------------------------------------------------
// 提示拼装
// ---------------------------------------------------------------------------

const ITEM_STATUS_LABELS: Record<ChapterAutoLoopItemStatus, string> = {
  pending: '待处理',
  applied: '已落实',
  relocated: '已重定位并落实',
  deleted: '已删除该段',
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
  /** 上一窗成稿末尾，只读衔接，禁止出条目 */
  previousWindowTail?: string;
}): string {
  const sections: string[] = [];

  sections.push(
    `【本轮】第 ${input.roundIndex} / ${input.roundBudget} 轮复诊${
      input.roundIndex > 1 ? '（诊断对象是上一轮改写后的最新稿）' : ''
    }`
  );
  sections.push(`【用户优化要求】\n${input.instruction.trim()}`);
  sections.push(`【章节】第 ${input.chapterNo} 章《${input.chapterTitle}》`);

  if (input.personaBlock?.trim()) {
    sections.push(`【人物卡】\n${input.personaBlock.trim()}`);
  }
  if (input.narrativeContext?.trim()) {
    sections.push(`【叙事上下文】\n${input.narrativeContext.trim()}`);
  }
  if (input.previousWindowTail?.trim()) {
    sections.push(
      [
        '【上一窗末文·只读】',
        '以下内容仅供衔接参考，禁止对其出条目或改写。',
        input.previousWindowTail.trim(),
      ].join('\n')
    );
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
    [
      '请只输出 JSON 条目。每条的 paragraphIndex 必须照抄上方 [n] 编号，anchorQuote 必须是 <indexed-chapter> 该段原文的连续摘录，不得摘录【叙事上下文】、【下章衔接】、【前章衔接】或【上一窗末文·只读】。',
      '只出两类条目：要求明显未落地，或上轮改坏。禁止把文风目标或「还能更贴要求」写成条目。没有这两类则输出 {"items":[]}。',
    ].join('\n')
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
  precedingText?: string;
  followingText?: string;
  personaBlock?: string;
}): string {
  const sections: string[] = [];

  sections.push(`【用户优化要求】\n${input.instruction.trim()}`);
  if (input.personaBlock?.trim()) {
    sections.push(`【人物卡】\n${input.personaBlock.trim()}`);
  }

  const itemLines = input.items.map(
    (item, position) =>
      `${position + 1}. （${item.severity}）${item.issue ? `${item.issue} → ` : ''}${item.instruction}`
  );
  sections.push(`<edit-items>\n${itemLines.join('\n')}\n</edit-items>`);

  const preceding = (input.precedingText ?? input.previousParagraph ?? '').trim();
  if (preceding) {
    sections.push(
      [
        '<preceding-paragraphs>',
        '以下为本段之前约两千字原文，只读，用于判断前文发生了什么。',
        preceding,
        '</preceding-paragraphs>',
      ].join('\n')
    );
  }
  sections.push(
    `<target-paragraph index="${input.paragraphIndex}">\n${input.originalParagraph.trim()}\n</target-paragraph>`
  );
  const following = (input.followingText ?? input.nextParagraph ?? '').trim();
  if (following) {
    sections.push(
      [
        '<following-paragraphs>',
        '以下为本段之后约两千字原文，只读。扩写不得提前写下这些情节、对白或结果。',
        following,
        '</following-paragraphs>',
      ].join('\n')
    );
  }

  sections.push('只输出 <target-paragraph> 改写后的正文，不要输出编号、标签、说明或前后文内容。');

  return sections.join('\n\n');
}

export function appendAutoLoopDiagnoseRetryHint(prompt: string): string {
  return `${prompt.trim()}\n\n【重试】上次输出无法解析为 JSON 条目。请只输出 {"items":[...]} ，每条必须含 paragraphIndex、anchorQuote、severity、instruction。不要说明、不要 Markdown。`;
}

/**
 * 单段改写的 token 预算。
 *
 * 按原段长度给预算，但下限足够短段扩写；不再按原段 2.5 倍卡死输出。
 */
export function resolveAutoLoopSegmentMaxTokens(originalParagraph: string): number {
  const estimated = Math.ceil(originalParagraph.length * SEGMENT_TOKENS_PER_CHAR);
  return Math.min(SEGMENT_MAX_MAX_TOKENS, Math.max(SEGMENT_MIN_MAX_TOKENS, estimated));
}

export interface AutoLoopPersonaLike {
  name: string;
  profile: string;
  state: string;
  status?: string;
}

function uniquePersonaNames(names: string[] | undefined): string[] {
  return [
    ...new Set((names ?? []).map((name) => name.trim()).filter((name) => name.length > 0)),
  ];
}

/**
 * 自动循环注入哪些角色卡。
 *
 * - 请求里带了名单：以这份为准（弹窗勾选）。
 * - 否则：正文里出现的人物名 ∪ 本章最近一次创作精修选角。
 * - 仍为空：回退全部已发布人物，避免循环完全看不到人设。
 */
export function resolveAutoLoopPersonaNames(input: {
  sourceText: string;
  personas: Array<{ name: string; status?: string }>;
  requestedNames?: string[];
  fallbackNames?: string[];
}): string[] {
  const requested = uniquePersonaNames(input.requestedNames);
  if (requested.length > 0) {
    return requested;
  }
  const appearing = input.personas
    .filter((persona) => persona.name?.trim() && input.sourceText.includes(persona.name))
    .map((persona) => persona.name);
  const merged = uniquePersonaNames([...appearing, ...(input.fallbackNames ?? [])]);
  if (merged.length > 0) {
    return merged;
  }
  return input.personas
    .filter((persona) => persona.status !== 'draft' && persona.name?.trim())
    .map((persona) => persona.name.trim());
}

/**
 * 出场人物卡文本块。按名字精确过滤，未匹配到就返回空串，
 * 让 prompt 里干脆没有【人物卡】小节，而不是留一个空标题误导模型。
 */
export function formatAutoLoopPersonaBlock(
  personas: AutoLoopPersonaLike[],
  appearingCharacters: string[] | undefined
): string {
  const names = new Set(uniquePersonaNames(appearingCharacters));
  if (names.size === 0) {
    return '';
  }
  return personas
    .filter((persona) => names.has(persona.name))
    .map((persona) => `${persona.name}：${persona.profile}\n状态：${persona.state}`)
    .join('\n\n');
}
