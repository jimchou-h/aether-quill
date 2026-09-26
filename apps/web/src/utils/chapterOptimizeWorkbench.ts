export type WorkbenchProfile = 'sex' | 'prose';
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

const WORKBENCH_REVIEW_KINDS = new Set<WorkbenchReviewKind>(['pose', 'vocab', 'regression']);
const ADDITIVE_REVIEW_INSTRUCTION = /加深|写细|补接吻|更色/;

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
