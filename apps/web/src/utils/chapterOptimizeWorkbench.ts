export type WorkbenchProfile = 'sex' | 'prose';
export type WorkbenchCreationMode = 'sex' | 'prose' | 'scene';
export type WorkbenchStepKey = 'range' | 'plan' | 'generate' | 'review' | 'apply';
export type WorkbenchReviewKind = 'pose' | 'vocab' | 'regression';

export interface WorkbenchReviewItem {
  id: string;
  kind: WorkbenchReviewKind | string;
  severity?: string;
  anchorQuote: string;
  issue: string;
  instruction: string;
}

export const WORKBENCH_SPAN_CONTEXT_CHARS = 400;
/** 按场创编的 plan 与成稿都只发单窗；超过这个字数的范围由前端先行拦截提示。 */
export const WORKBENCH_SCENE_MAX_RANGE_CHARS = 5200;

const WORKBENCH_REVIEW_KINDS = new Set<WorkbenchReviewKind>(['pose', 'vocab', 'regression']);
const ADDITIVE_REVIEW_INSTRUCTION = /加深|写细|更浓|再补细节|补接吻|更色/;

/** UTF-16 splice, matching JavaScript `String.prototype.slice`. */
export function spliceChapterRange(
  baseText: string,
  startOffset: number,
  endOffset: number,
  rangeDraft: string
): string {
  return baseText.slice(0, startOffset) + rangeDraft + baseText.slice(endOffset);
}

/** Unique exact match; 0 or >1 hits returns null. */
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

export function filterWorkbenchReviewItems<T extends WorkbenchReviewItem>(items: T[]): T[] {
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

/** Drop pose/vocab on the prose profile even if the model slips them through. */
export function filterWorkbenchReviewItemsForProfile<T extends WorkbenchReviewItem>(
  items: T[],
  profile: WorkbenchProfile
): T[] {
  const legal = filterWorkbenchReviewItems(items);
  if (profile !== 'prose') {
    return legal;
  }
  return legal.filter((item) => item.kind === 'regression');
}

/**
 * review 过滤口径：直出档沿用 profile（文笔档只留改差）；按场创编全开三类。
 * 两类都仍由 filterWorkbenchReviewItems 丢弃非法 kind 与「加深/写细」类加料指令。
 */
export function filterWorkbenchReviewItemsForMode<T extends WorkbenchReviewItem>(
  items: T[],
  mode: WorkbenchCreationMode
): T[] {
  if (mode === 'scene') {
    return filterWorkbenchReviewItems(items);
  }
  return filterWorkbenchReviewItemsForProfile(items, mode);
}

export function describeInvalidWorkbenchRange(
  startOffset: number,
  endOffset: number,
  sourceText: string
): string | null {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) {
    return '请在冻结正文中划选连续范围';
  }
  if (startOffset < 0 || endOffset < 0 || startOffset >= endOffset) {
    return '起止为空或起止颠倒，请重新划选';
  }
  if (endOffset > sourceText.length) {
    return '划选范围超出冻结正文';
  }
  if (!sourceText.slice(startOffset, endOffset).trim()) {
    return '划选范围为空白，请重新划选';
  }
  return null;
}

export function sliceSpanNeighborhood(
  text: string,
  start: number,
  end: number,
  contextChars = WORKBENCH_SPAN_CONTEXT_CHARS
): { spanText: string; beforeContext: string; afterContext: string } {
  return {
    spanText: text.slice(start, end),
    beforeContext: text.slice(Math.max(0, start - contextChars), start),
    afterContext: text.slice(end, Math.min(text.length, end + contextChars)),
  };
}

export function normalizeWorkbenchReviewItems(raw: unknown): WorkbenchReviewItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry, index) => {
    const rec = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    return {
      id: id || `w${index + 1}`,
      kind: typeof rec.kind === 'string' ? rec.kind : '',
      severity: typeof rec.severity === 'string' ? rec.severity : undefined,
      anchorQuote: typeof rec.anchorQuote === 'string' ? rec.anchorQuote : '',
      issue: typeof rec.issue === 'string' ? rec.issue : '',
      instruction: typeof rec.instruction === 'string' ? rec.instruction : '',
    };
  });
}

/** Server onEnd uses `finalDraftText`; accept draftText/spanText if a proxy remaps fields. */
export function resolveWorkbenchSseEndText(event: {
  finalDraftText?: string;
  draftText?: string;
  spanText?: string;
}): string {
  for (const candidate of [event.finalDraftText, event.draftText, event.spanText]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return '';
}

/** Keep the streamed draft when end text is empty or identical, so the textarea does not rewrite twice. */
export function applyWorkbenchSseEndText(streamed: string, ended: string): string {
  if (ended && ended !== streamed) {
    return ended;
  }
  return streamed;
}

export interface WorkbenchRangeOffsets {
  start: number;
  end: number;
}

/** Apply / preview stay on the range that produced the current draft, even if the user reselects. */
export function resolveWorkbenchApplyOffsets(input: {
  draftText: string;
  committedStart: number;
  committedEnd: number;
  selectedStart: number;
  selectedEnd: number;
}): WorkbenchRangeOffsets {
  if (input.draftText) {
    return { start: input.committedStart, end: input.committedEnd };
  }
  return { start: input.selectedStart, end: input.selectedEnd };
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

export function describeWorkbenchRangeBinding(input: {
  hasSelectedRange: boolean;
  selectedStart: number;
  selectedEnd: number;
  selectedChars: number;
  hasDraft: boolean;
  committedStart: number;
  committedEnd: number;
  committedChars: number;
}): string {
  if (!input.hasSelectedRange && !input.hasDraft) {
    return '尚未划选';
  }
  const selected = `${input.selectedStart}–${input.selectedEnd}（${input.selectedChars} 字）`;
  if (!input.hasDraft) {
    return selected;
  }
  const committed = `${input.committedStart}–${input.committedEnd}（${input.committedChars} 字）`;
  if (
    input.hasSelectedRange &&
    (input.selectedStart !== input.committedStart || input.selectedEnd !== input.committedEnd)
  ) {
    return `成稿仍按 ${committed}；当前划选 ${selected} 只影响下次生成`;
  }
  return `成稿范围 ${committed}`;
}

export function isSceneRewriteMode(mode: WorkbenchCreationMode): mode is 'scene' {
  return mode === 'scene';
}

/** 按场创编没有感官/文笔档位，但 draft 接口仍要求 profile，统一按日常文笔上报。 */
export function resolveWorkbenchDraftProfile(mode: WorkbenchCreationMode): WorkbenchProfile {
  return mode === 'scene' ? 'prose' : mode;
}

/**
 * review / 点修的档位。按场创编要全开三类（pose/vocab/regression），
 * 服务端只有非 prose 档不做裁剪，故复用感官档；两个直出档沿用自身档位，行为不变。
 */
export function resolveWorkbenchReviewProfile(mode: WorkbenchCreationMode): WorkbenchProfile {
  return isSceneRewriteMode(mode) ? 'sex' : mode;
}

/** 步骤机：两个直出档 4 步；按场创编在「划范围」后多一个「创编方案」步骤。 */
export function resolveWorkbenchCreationSteps(
  mode: WorkbenchCreationMode
): Array<{ key: WorkbenchStepKey; label: string }> {
  return [
    { key: 'range', label: '划范围' },
    ...(isSceneRewriteMode(mode) ? [{ key: 'plan' as const, label: '创编方案' }] : []),
    { key: 'generate', label: '生成' },
    { key: 'review', label: '检查/点句' },
    { key: 'apply', label: '应用' },
  ];
}

/** 按场创编只做单窗；超窗时返回给作者看的提示，未超窗返回 null。 */
export function describeSceneRangeOverflow(rangeChars: number): string | null {
  if (rangeChars <= WORKBENCH_SCENE_MAX_RANGE_CHARS) {
    return null;
  }
  return `按场创编一次最多约 ${WORKBENCH_SCENE_MAX_RANGE_CHARS} 字，当前范围 ${rangeChars} 字。请把范围划小一点再试。`;
}

export function canConfirmWorkbenchPlan(planText: string): boolean {
  return Boolean(planText.trim());
}

/** 生成按钮的放行条件：直出档沿用旧口径；创编档还要求「方案已确认」且范围不超窗。 */
export function canGenerateWorkbenchDraft(input: {
  mode: WorkbenchCreationMode;
  hasRange: boolean;
  rangeChars: number;
  instruction: string;
  planConfirmed: boolean;
  busy: boolean;
}): boolean {
  if (input.busy || !input.hasRange || !input.instruction.trim()) {
    return false;
  }
  if (!isSceneRewriteMode(input.mode)) {
    return true;
  }
  if (describeSceneRangeOverflow(input.rangeChars)) {
    return false;
  }
  return input.planConfirmed;
}

/** 直出档返回空对象，保证旧请求体不变；创编档附带 mode 与已确认方案。 */
export function buildWorkbenchDraftModeFields(
  mode: WorkbenchCreationMode,
  planText: string
): { mode?: 'from-plan'; planText?: string } {
  if (!isSceneRewriteMode(mode)) {
    return {};
  }
  return { mode: 'from-plan', planText };
}
