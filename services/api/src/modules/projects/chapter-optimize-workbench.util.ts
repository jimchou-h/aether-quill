/**
 * 按场成稿台（openspec: add-optimize-scene-workbench）
 *
 * 与 from-plan / direct / auto-loop 并列的新路径。禁止改现有 rewriteMode 枚举或
 * 让 direct 开始读取 sourceText。范围内禁止按字数切窗。
 */

export const CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY =
  'chapter.optimize.workbench-draft-sex';
export const CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY =
  'chapter.optimize.workbench-draft-prose';
export const CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_TEMPLATE_KEY = 'chapter.optimize.workbench-review';
export const CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_TEMPLATE_KEY =
  'chapter.optimize.workbench-fix-span';

export type ChapterOptimizeWorkbenchProfile = 'sex' | 'prose';
export type WorkbenchReviewKind = 'pose' | 'vocab' | 'regression';
export type WorkbenchReviewSeverity = 'high' | 'medium' | 'low';

export interface WorkbenchReviewItem {
  id: string;
  kind: WorkbenchReviewKind;
  severity: WorkbenchReviewSeverity;
  anchorQuote: string;
  issue: string;
  instruction: string;
}

const WORKBENCH_REVIEW_KINDS = new Set<WorkbenchReviewKind>(['pose', 'vocab', 'regression']);
const ADDITIVE_REVIEW_INSTRUCTION = /加深|写细|更浓|再补细节|补接吻|更色/;
const SOURCE_TEXT_MAX = 200000;
const INSTRUCTION_MAX = 20000;
const RANGE_TEXT_MAX = 200000;
const SPAN_TEXT_MAX = 20000;
const CONTEXT_MAX = 2000;
/** 范围前后只读衔接，不改写、不拼进输出。 */
export const WORKBENCH_RANGE_CONTEXT_CHARS = 2000;
/** 单窗超过这个长度，后半很容易原样粘贴；同场按窗续写。 */
export const WORKBENCH_REWRITE_WINDOW_CHARS = 5200;

export const CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在对用户划定的连续范围内正文做感官加料改写。',
  'ONLY：输出该范围内改写后的正文；禁止输出范围外文字、方案、说明、Markdown 标题或代码块。',
  '工作方式：按【用户优化要求】在范围内从头到尾加料重写，加深感官、节奏与场面细节；须保持范围内时序与空间连续，禁止跳写或省略中间过程。',
  '硬约束：',
  '1) 只改写 <range-original> 中的内容，禁止输出范围前后的原文；',
  '2) 以范围内情节与信息为基础，禁止凭空另起无关剧情；',
  '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；禁止大段照抄原文；禁止前半加料、后半原样粘贴；禁止原样输出 <range-original>；',
  '4) 人称、时态、人物名称须与原文一致，除非用户要求明确修改；句式与感官描写必须重写，不得逐句复述；',
  '5) 仓库默认不含任何私有词表；不要发明或套用未在用户要求中出现的固定替换词。',
  '6) <before-context> 与 <after-context> 只读，禁止复述或并入输出；改写后的开头须能接在 before 之后，结尾须能接到 after 之前。',
  '7) 必须有读者能看出来的加料（感官、动作或节奏至少一处加密）。原文原样交回视为失败。',
].join('\n');

export const CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在对用户划定的连续范围内正文做日常文笔润色。',
  'ONLY：输出该范围内改写后的正文；禁止输出范围外文字、方案、说明、Markdown 标题或代码块。',
  '工作方式：按【用户优化要求】理顺节奏、对白与衔接；禁止按感官加料要求增色、堆砌特写或无必要地夸张动作。',
  '硬约束：',
  '1) 只改写 <range-original> 中的内容，禁止输出范围前后的原文；',
  '2) 以范围内情节与信息为基础，禁止凭空另起无关剧情；',
  '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；禁止大段照抄原文；禁止原样输出 <range-original>；',
  '4) 人称、时态、人物名称须与原文一致，除非用户要求明确修改；句式必须重写，不得逐句复述；',
  '5) 禁止把过场无端改写成高潮冲突场面。',
  '6) <before-context> 与 <after-context> 只读，禁止复述或并入输出；改写后的开头须能接在 before 之后，结尾须能接到 after 之前。',
  '7) 必须做出可见的节奏、对白或衔接改动。原文原样交回视为失败。',
].join('\n');

export const CHAPTER_OPTIMIZE_WORKBENCH_REVIEW_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对范围内成稿做一次定点检查。',
  'ONLY：输出 JSON；禁止输出正文、方案散文或 Markdown。',
  '只输出：{"items":[{"id":"w1","kind":"pose|vocab|regression","severity":"high|medium|low","anchorQuote":"成稿摘录","issue":"问题","instruction":"改写指令"}]}',
  '硬约束：',
  '1) 没有问题必须返回 {"items":[]}，禁止凑数。',
  '2) kind 只允许 pose、vocab、regression。',
  '3) regression 仅描述：缩写、并段、当拍接触被删、比喻被砍残。不得把「还能更浓 / 加深 / 写细 / 再补细节」写成条目。',
  '4) 若档位为日常文笔（prose）：只允许 regression（可含衔接接不上）；禁止 pose / vocab，禁止要求补动作特写或词表替换。',
  '5) 若档位为感官加料（sex）：pose 查动作/空间穿帮，vocab 查用词问题，regression 查改差。',
  '6) anchorQuote 必须是成稿中连续出现的原文片段，至少 8 字，不得改写。',
  '7) instruction 必须写明要改成什么，禁止「加深」「写细」「更浓」「再补细节」及同类加料指令。',
  '8) 禁止把用户私有词表写进条目。',
].join('\n');

export const CHAPTER_OPTIMIZE_WORKBENCH_FIX_SPAN_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按指令改写用户划定的一小段选区。',
  'ONLY：输出替换后的选区正文；禁止输出选区外文字、说明、Markdown 或代码块。',
  '硬约束：',
  '1) 只改写 <span-original>；<before-context> 与 <after-context> 只读，禁止复述或并入输出；',
  '2) 必须落实【改写指令】，不得另起方案、不得扩写到选区外情节；',
  '3) 保持人称、时态与人物名称；不得使用占位语；',
  '4) 输出必须可以直接替换原选区，前后衔接由调用方拼回。',
].join('\n');

export function spliceChapterRange(
  baseText: string,
  startOffset: number,
  endOffset: number,
  rangeDraft: string
): string {
  return baseText.slice(0, startOffset) + rangeDraft + baseText.slice(endOffset);
}

export function locateUniqueAnchor(
  haystack: string,
  quote: string
): { start: number; end: number } | null {
  if (!quote) {
    return null;
  }
  const start = haystack.indexOf(quote);
  if (start < 0) {
    return null;
  }
  if (haystack.indexOf(quote, start + 1) >= 0) {
    return null;
  }
  return { start, end: start + quote.length };
}

export function isLegalWorkbenchReviewKind(kind: string): kind is WorkbenchReviewKind {
  return WORKBENCH_REVIEW_KINDS.has(kind as WorkbenchReviewKind);
}

export function filterWorkbenchReviewItems<T extends { kind: string; instruction: string }>(
  items: T[]
): T[] {
  return items.filter((item) => {
    if (!isLegalWorkbenchReviewKind(String(item.kind))) {
      return false;
    }
    if (ADDITIVE_REVIEW_INSTRUCTION.test(item.instruction ?? '')) {
      return false;
    }
    return true;
  });
}

/** Never reuse chapter-optimize `splitIntoSegments`; workbench has its own continuation windows. */
export function shouldSplitWorkbenchRange(_rangeText?: string): boolean {
  void _rangeText;
  return false;
}

export interface WorkbenchRewriteWindow {
  start: number;
  end: number;
  text: string;
}

function findWorkbenchWindowBreak(text: string, start: number, hardEnd: number): number {
  const slice = text.slice(start, hardEnd);
  const minKeep = Math.floor(slice.length * 0.55);
  const paragraph = slice.lastIndexOf('\n\n');
  if (paragraph >= minKeep) {
    return start + paragraph + 2;
  }
  let best = -1;
  for (const mark of ['。', '！', '？', '…', '\n']) {
    const index = slice.lastIndexOf(mark);
    if (index >= minKeep && index > best) {
      best = index;
    }
  }
  if (best >= 0) {
    return start + best + 1;
  }
  return hardEnd;
}

/** Split one user-drawn scene into sequential rewrite windows. Join of `.text` MUST equal the range. */
export function splitWorkbenchRewriteWindows(
  rangeText: string,
  maxChars = WORKBENCH_REWRITE_WINDOW_CHARS
): WorkbenchRewriteWindow[] {
  if (rangeText.length <= maxChars) {
    return [{ start: 0, end: rangeText.length, text: rangeText }];
  }
  const windows: WorkbenchRewriteWindow[] = [];
  let start = 0;
  while (start < rangeText.length) {
    if (rangeText.length - start <= maxChars) {
      windows.push({
        start,
        end: rangeText.length,
        text: rangeText.slice(start),
      });
      break;
    }
    const end = findWorkbenchWindowBreak(rangeText, start, start + maxChars);
    if (end <= start) {
      windows.push({
        start,
        end: rangeText.length,
        text: rangeText.slice(start),
      });
      break;
    }
    windows.push({
      start,
      end,
      text: rangeText.slice(start, end),
    });
    start = end;
  }
  return windows;
}

export function resolveWorkbenchDraftTemplateKey(profile: ChapterOptimizeWorkbenchProfile): string {
  return profile === 'prose'
    ? CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_TEMPLATE_KEY
    : CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_TEMPLATE_KEY;
}

export function resolveWorkbenchDraftSystemPrompt(
  profile: ChapterOptimizeWorkbenchProfile
): string {
  return profile === 'prose'
    ? CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_PROSE_SYSTEM_PROMPT
    : CHAPTER_OPTIMIZE_WORKBENCH_DRAFT_SEX_SYSTEM_PROMPT;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function normalizeWorkbenchProfile(value: unknown): ChapterOptimizeWorkbenchProfile {
  if (value === 'prose' || value === 'sex') {
    return value;
  }
  throw new Error('profile 必须为 sex 或 prose');
}

export function sliceWorkbenchRangeNeighborhood(
  sourceText: string,
  startOffset: number,
  endOffset: number,
  contextChars = WORKBENCH_RANGE_CONTEXT_CHARS
): { beforeContext: string; afterContext: string } {
  return {
    beforeContext: sourceText.slice(Math.max(0, startOffset - contextChars), startOffset),
    afterContext: sourceText.slice(endOffset, Math.min(sourceText.length, endOffset + contextChars)),
  };
}

export function sliceWorkbenchRange(
  sourceText: string,
  startOffset: number,
  endOffset: number
): string {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) {
    throw new Error('起止偏移必须为整数');
  }
  if (startOffset < 0 || endOffset < 0) {
    throw new Error('起止偏移不能为负数');
  }
  if (startOffset >= endOffset) {
    throw new Error('起止为空或起止颠倒，请重新划选');
  }
  if (endOffset > sourceText.length) {
    throw new Error('划选范围超出冻结正文');
  }
  const rangeText = sourceText.slice(startOffset, endOffset);
  if (!rangeText.trim()) {
    throw new Error('划选范围为空白，请重新划选');
  }
  return rangeText;
}

export function assertWorkbenchDraftRequest(input: {
  instruction?: unknown;
  profile?: unknown;
  startOffset?: unknown;
  endOffset?: unknown;
  baseUpdatedAt?: unknown;
  sourceText?: unknown;
  appearingCharacters?: unknown;
}): {
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  startOffset: number;
  endOffset: number;
  baseUpdatedAt: string;
  sourceText: string;
  rangeText: string;
  beforeContext: string;
  afterContext: string;
  appearingCharacters: string[] | undefined;
} {
  const instruction = asTrimmedString(input.instruction);
  if (!instruction) {
    throw new Error('优化要求 instruction 不能为空');
  }
  if (instruction.length > INSTRUCTION_MAX) {
    throw new Error(`优化要求 instruction 长度不能超过 ${INSTRUCTION_MAX} 字符`);
  }
  const profile = normalizeWorkbenchProfile(input.profile);
  const sourceText = typeof input.sourceText === 'string' ? input.sourceText : '';
  if (!sourceText) {
    throw new Error('冻结正文 sourceText 不能为空');
  }
  if (sourceText.length > SOURCE_TEXT_MAX) {
    throw new Error(`冻结正文 sourceText 长度不能超过 ${SOURCE_TEXT_MAX} 字符`);
  }
  const startOffset = asInteger(input.startOffset);
  const endOffset = asInteger(input.endOffset);
  if (startOffset === null || endOffset === null) {
    throw new Error('起止偏移必须为整数');
  }
  const baseUpdatedAt = asTrimmedString(input.baseUpdatedAt);
  if (!baseUpdatedAt) {
    throw new Error('baseUpdatedAt 必须为 ISO 时间字符串');
  }
  const parsed = new Date(baseUpdatedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('baseUpdatedAt 不是合法的 ISO 时间字符串');
  }
  const rangeText = sliceWorkbenchRange(sourceText, startOffset, endOffset);
  const neighborhood = sliceWorkbenchRangeNeighborhood(sourceText, startOffset, endOffset);
  return {
    instruction,
    profile,
    startOffset,
    endOffset,
    baseUpdatedAt: parsed.toISOString(),
    sourceText,
    rangeText,
    beforeContext: neighborhood.beforeContext,
    afterContext: neighborhood.afterContext,
    appearingCharacters: normalizeAppearingCharacters(input.appearingCharacters),
  };
}

export function assertWorkbenchReviewRequest(input: {
  instruction?: unknown;
  profile?: unknown;
  rangeText?: unknown;
  appearingCharacters?: unknown;
}): {
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  rangeText: string;
  appearingCharacters: string[] | undefined;
} {
  const profile = normalizeWorkbenchProfile(input.profile);
  const rangeText = typeof input.rangeText === 'string' ? input.rangeText : '';
  if (!rangeText.trim()) {
    throw new Error('范围成稿 rangeText 不能为空');
  }
  if (rangeText.length > RANGE_TEXT_MAX) {
    throw new Error(`范围成稿 rangeText 长度不能超过 ${RANGE_TEXT_MAX} 字符`);
  }
  const instruction = asTrimmedString(input.instruction);
  if (instruction.length > INSTRUCTION_MAX) {
    throw new Error(`优化要求 instruction 长度不能超过 ${INSTRUCTION_MAX} 字符`);
  }
  return {
    instruction,
    profile,
    rangeText,
    appearingCharacters: normalizeAppearingCharacters(input.appearingCharacters),
  };
}

export function assertWorkbenchFixSpanRequest(input: {
  spanText?: unknown;
  instruction?: unknown;
  profile?: unknown;
  beforeContext?: unknown;
  afterContext?: unknown;
  appearingCharacters?: unknown;
}): {
  spanText: string;
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  beforeContext: string;
  afterContext: string;
  appearingCharacters: string[] | undefined;
} {
  const spanText = typeof input.spanText === 'string' ? input.spanText : '';
  if (!spanText) {
    throw new Error('选区 spanText 不能为空');
  }
  if (spanText.length > SPAN_TEXT_MAX) {
    throw new Error(`选区 spanText 长度不能超过 ${SPAN_TEXT_MAX} 字符`);
  }
  const instruction = asTrimmedString(input.instruction);
  if (!instruction) {
    throw new Error('改写指令 instruction 不能为空');
  }
  if (instruction.length > INSTRUCTION_MAX) {
    throw new Error(`改写指令 instruction 长度不能超过 ${INSTRUCTION_MAX} 字符`);
  }
  const profile = normalizeWorkbenchProfile(input.profile);
  const beforeContext =
    typeof input.beforeContext === 'string' ? input.beforeContext.slice(0, CONTEXT_MAX) : '';
  const afterContext =
    typeof input.afterContext === 'string' ? input.afterContext.slice(0, CONTEXT_MAX) : '';
  return {
    spanText,
    instruction,
    profile,
    beforeContext,
    afterContext,
    appearingCharacters: normalizeAppearingCharacters(input.appearingCharacters),
  };
}

function normalizeAppearingCharacters(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((name) => name.length >= 1);
  return names.length > 0 ? names : undefined;
}

export function buildWorkbenchDraftUserPrompt(input: {
  chapterNo: number;
  title: string;
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  rangeText: string;
  beforeContext?: string;
  afterContext?: string;
  appearingCharacters?: string[];
  windowIndex?: number;
  windowTotal?: number;
}): string {
  const sections: string[] = [];
  const profileLabel = input.profile === 'prose' ? '日常文笔' : '感官加料';
  const windowTotal = input.windowTotal && input.windowTotal > 1 ? input.windowTotal : 0;
  const windowIndex = windowTotal ? (input.windowIndex ?? 0) + 1 : 0;
  sections.push(
    `【写作目标】请按「${profileLabel}」档改写第${input.chapterNo}章「${input.title}」中用户划定的连续范围。`
  );
  if (windowTotal) {
    sections.push(
      `【续写窗】这是同一场的第 ${windowIndex}/${windowTotal} 段。只改写本窗 <range-original>。已改写的前文在 <before-context>，必须顺接。禁止复述前文，禁止把后窗原文提前写完，禁止本窗后半原样粘贴。`
    );
  }
  sections.push(`【用户优化要求】\n${input.instruction}`);
  if (input.appearingCharacters?.length) {
    sections.push(`【本章出场角色】${input.appearingCharacters.join('、')}`);
  }
  if (input.profile === 'prose') {
    sections.push('【档位约束】本档为日常文笔。禁止按感官加料要求增色、堆砌特写或无必要地夸张动作。');
  }
  if (input.beforeContext) {
    sections.push(`<before-context>\n${input.beforeContext}\n</before-context>`);
  }
  sections.push(`<range-original>\n${input.rangeText}\n</range-original>`);
  if (input.afterContext) {
    sections.push(`<after-context>\n${input.afterContext}\n</after-context>`);
  }
  sections.push(
    [
      '请直接输出该范围内改写后的正文纯文本，不要方案、说明、Markdown 标题或代码块。',
      '必须基于 <range-original> 从头到尾重写；禁止输出范围外原文。',
      '禁止大段照抄原文；禁止「前半改写、后半原样粘贴」；禁止原样输出 <range-original>。',
      input.profile === 'sex'
        ? '感官加料：必须有可见加料。原文原样交回视为失败。'
        : '日常文笔：必须有可见的节奏、对白或衔接改动；禁止原样交回；禁止增色。',
      '若有 <before-context> / <after-context>：只读，用来把头尾接上；不要复述或改写它们。',
    ].join('\n')
  );
  return sections.join('\n\n');
}

/** Cheap copy detector for long ranges: exact match, or same length band with 2+ intact mid windows. */
export function isNearCopyWorkbenchDraft(original: string, draft: string): boolean {
  const source = original.trim();
  const output = draft.trim();
  if (!source || !output) {
    return false;
  }
  if (source === output) {
    return true;
  }
  const lengthDelta = Math.abs(source.length - output.length) / source.length;
  const windowSize = Math.min(400, Math.max(80, Math.floor(source.length / 8)));
  if (source.length < windowSize * 3) {
    const half = Math.floor(source.length / 2);
    return lengthDelta < 0.02 && source.slice(0, half) === output.slice(0, half);
  }
  const probes = [0.25, 0.5, 0.75].map((ratio) => {
    const start = Math.floor(source.length * ratio);
    return source.slice(start, start + windowSize);
  });
  const intactWindows = probes.filter((probe) => probe && output.includes(probe)).length;
  return intactWindows >= 2 && lengthDelta < 0.08;
}

export function buildWorkbenchReviewUserPrompt(input: {
  chapterNo: number;
  title: string;
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  rangeText: string;
  appearingCharacters?: string[];
}): string {
  const sections: string[] = [];
  const profileLabel = input.profile === 'prose' ? '日常文笔' : '感官加料';
  sections.push(
    `【检查目标】第${input.chapterNo}章「${input.title}」范围内成稿检查（档位：${profileLabel}）`
  );
  if (input.instruction) {
    sections.push(`【用户优化要求】\n${input.instruction}`);
  }
  if (input.appearingCharacters?.length) {
    sections.push(`【本章出场角色】${input.appearingCharacters.join('、')}`);
  }
  if (input.profile === 'prose') {
    sections.push(
      '【档位约束】日常文笔：只允许 regression（可含衔接接不上）。禁止 pose / vocab，禁止要求补动作特写或词表替换。'
    );
  } else {
    sections.push(
      '【档位约束】感官加料：pose=动作/空间穿帮，vocab=用词问题，regression=改差。没有问题返回空列表。'
    );
  }
  sections.push(`<range-draft>\n${input.rangeText}\n</range-draft>`);
  sections.push('只输出 JSON。没有问题必须 {"items":[]}。');
  return sections.join('\n\n');
}

export function buildWorkbenchFixSpanUserPrompt(input: {
  instruction: string;
  profile: ChapterOptimizeWorkbenchProfile;
  spanText: string;
  beforeContext: string;
  afterContext: string;
}): string {
  const sections: string[] = [];
  const profileLabel = input.profile === 'prose' ? '日常文笔' : '感官加料';
  sections.push(`【改写档位】${profileLabel}`);
  sections.push(`【改写指令】\n${input.instruction}`);
  if (input.beforeContext) {
    sections.push(`<before-context>\n${input.beforeContext}\n</before-context>`);
  }
  sections.push(`<span-original>\n${input.spanText}\n</span-original>`);
  if (input.afterContext) {
    sections.push(`<after-context>\n${input.afterContext}\n</after-context>`);
  }
  sections.push('只输出替换后的选区正文，不要选区外文字、说明或 Markdown。');
  return sections.join('\n\n');
}

function extractJsonPayload(raw: unknown): unknown {
  let payload = raw;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      const objectMatch = jsonText.match(/\{[\s\S]*\}/);
      if (!objectMatch) {
        return undefined;
      }
      try {
        payload = JSON.parse(objectMatch[0]);
      } catch {
        return undefined;
      }
    }
  }
  return payload;
}

export function parseWorkbenchReviewItems(
  raw: unknown,
  profile: ChapterOptimizeWorkbenchProfile
): WorkbenchReviewItem[] {
  const payload = extractJsonPayload(raw);
  const rawItems = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  const parsed: WorkbenchReviewItem[] = [];
  let index = 0;
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : '';
    const anchorQuote = typeof record.anchorQuote === 'string' ? record.anchorQuote.trim() : '';
    const issue = typeof record.issue === 'string' ? record.issue.trim() : '';
    if (!isLegalWorkbenchReviewKind(kind) || !instruction || !anchorQuote) {
      continue;
    }
    if (profile === 'prose' && (kind === 'pose' || kind === 'vocab')) {
      continue;
    }
    if (ADDITIVE_REVIEW_INSTRUCTION.test(instruction)) {
      continue;
    }
    index += 1;
    const providedId = typeof record.id === 'string' ? record.id.trim() : '';
    const severityRaw = typeof record.severity === 'string' ? record.severity.trim() : '';
    const severity: WorkbenchReviewSeverity =
      severityRaw === 'high' || severityRaw === 'medium' || severityRaw === 'low'
        ? severityRaw
        : 'medium';
    parsed.push({
      id: providedId || `w${index}`,
      kind,
      severity,
      anchorQuote,
      issue,
      instruction,
    });
  }
  return filterWorkbenchReviewItems(parsed);
}
