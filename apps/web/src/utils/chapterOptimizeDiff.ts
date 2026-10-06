import { diffChars as computeDiff, type Change } from 'diff';

export interface DiffSegment {
  text: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffLineResult {
  originalSegments: DiffSegment[];
  draftSegments: DiffSegment[];
  type: 'unchanged' | 'added' | 'removed' | 'modified';
}

export interface InlineDiffSegment {
  text: string;
  removed?: boolean;
  added?: boolean;
}

export interface OptimizeDiffBundle {
  inline: {
    originalSegments: InlineDiffSegment[];
    draftSegments: InlineDiffSegment[];
  };
  lines: DiffLineResult[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
}

function buildChapterDiffLinesFromChanges(changes: Change[]): DiffLineResult[] {
  const origLines: DiffSegment[][] = [];
  const draftLines: DiffSegment[][] = [];

  let currentOrigLine: DiffSegment[] = [];
  let currentDraftLine: DiffSegment[] = [];

  function flushOrigLine() {
    if (currentOrigLine.length > 0) {
      origLines.push(currentOrigLine);
    }
    currentOrigLine = [];
  }

  function flushDraftLine() {
    if (currentDraftLine.length > 0) {
      draftLines.push(currentDraftLine);
    }
    currentDraftLine = [];
  }

  for (const change of changes) {
    const parts = change.value.split('\n');

    for (let i = 0; i < parts.length; i++) {
      const text = parts[i];
      const isLast = i === parts.length - 1;

      if (change.added) {
        if (!change.removed) {
          currentDraftLine.push({ text, added: true });
          if (!isLast) {
            flushDraftLine();
            currentOrigLine = [{ text: '', removed: false }];
            flushOrigLine();
            currentOrigLine = [];
          }
        } else {
          currentDraftLine.push({ text, added: true });
          if (!isLast) {
            flushDraftLine();
          }
        }
      }

      if (change.removed) {
        if (!change.added) {
          currentOrigLine.push({ text, removed: true });
          if (!isLast) {
            flushOrigLine();
            currentDraftLine = [{ text: '', added: false }];
            flushDraftLine();
            currentDraftLine = [];
          }
        } else {
          currentOrigLine.push({ text, removed: true });
          if (!isLast) {
            flushOrigLine();
          }
        }
      }

      if (!change.added && !change.removed) {
        currentOrigLine.push({ text });
        currentDraftLine.push({ text });
        if (!isLast) {
          flushOrigLine();
          flushDraftLine();
        }
      }
    }
  }

  flushOrigLine();
  flushDraftLine();

  const maxLen = Math.max(origLines.length, draftLines.length);
  const results: DiffLineResult[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oSegs = origLines[i] ?? [{ text: '' }];
    const dSegs = draftLines[i] ?? [{ text: '' }];

    if (i < origLines.length && i < draftLines.length) {
      const oText = oSegs.map((s) => s.text).join('');
      const dText = dSegs.map((s) => s.text).join('');
      const hasRemoved = oSegs.some((s) => s.removed);
      const hasAdded = dSegs.some((s) => s.added);

      if (hasRemoved || hasAdded || oText !== dText) {
        results.push({
          type:
            hasRemoved && !hasAdded && oText && !dText.trim()
              ? 'removed'
              : hasAdded && !hasRemoved && !oText.trim() && dText
                ? 'added'
                : 'modified',
          originalSegments: oSegs,
          draftSegments: dSegs,
        });
      } else {
        results.push({
          type: 'unchanged',
          originalSegments: oSegs,
          draftSegments: dSegs,
        });
      }
    } else if (i >= origLines.length) {
      results.push({
        type: 'added',
        originalSegments: [{ text: '' }],
        draftSegments: dSegs,
      });
    } else {
      results.push({
        type: 'removed',
        originalSegments: oSegs,
        draftSegments: [{ text: '' }],
      });
    }
  }

  return results;
}

function buildInlineDiffViewsFromChanges(changes: Change[]): {
  originalSegments: InlineDiffSegment[];
  draftSegments: InlineDiffSegment[];
} {
  const originalSegments: InlineDiffSegment[] = [];
  const draftSegments: InlineDiffSegment[] = [];

  for (const change of changes) {
    if (change.removed) {
      originalSegments.push({ text: change.value, removed: true });
    } else if (change.added) {
      draftSegments.push({ text: change.value, added: true });
    } else {
      originalSegments.push({ text: change.value });
      draftSegments.push({ text: change.value });
    }
  }

  return { originalSegments, draftSegments };
}

export function buildChapterDiffLines(original: string, draft: string): DiffLineResult[] {
  if (!original && !draft) {
    return [];
  }
  return buildChapterDiffLinesFromChanges(computeDiff(original, draft));
}

/**
 * SSE / 自动循环未结束时不算、不渲染红绿对照，避免每条流式增量重跑整章 diff。
 * 生成结束后由 ComparePane 自动算一次；用户改字后需点「生成对照」，不再防抖自动刷新。
 */
export function shouldRenderOptimizeDiff(isGenerating: boolean): boolean {
  return !isGenerating;
}

/** 全文并排高亮：左栏标删除、右栏标新增，不丢段落 */
export function buildInlineDiffViews(
  original: string,
  draft: string
): { originalSegments: InlineDiffSegment[]; draftSegments: InlineDiffSegment[] } {
  if (!original && !draft) {
    return { originalSegments: [], draftSegments: [] };
  }
  return buildInlineDiffViewsFromChanges(computeDiff(original, draft));
}

/** 一次字级 diff，同时产出高亮与行统计，避免结束瞬间跑两遍。 */
export function buildOptimizeDiffBundle(original: string, draft: string): OptimizeDiffBundle {
  if (!original && !draft) {
    return {
      inline: { originalSegments: [], draftSegments: [] },
      lines: [],
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
    };
  }

  const changes = computeDiff(original, draft);
  const lines = buildChapterDiffLinesFromChanges(changes);
  return {
    inline: buildInlineDiffViewsFromChanges(changes),
    lines,
    addedCount: lines.filter((row) => row.type === 'added').length,
    removedCount: lines.filter((row) => row.type === 'removed').length,
    modifiedCount: lines.filter((row) => row.type === 'modified').length,
  };
}
