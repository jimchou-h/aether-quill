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

export function buildChapterDiffLines(original: string, draft: string): DiffLineResult[] {
  if (!original && !draft) {
    return [];
  }

  const changes: Change[] = computeDiff(original, draft);
  const origLines: DiffSegment[][] = [];
  const draftLines: DiffSegment[][] = [];

  let currentOrigLine: DiffSegment[] = [];
  let currentDraftLine: DiffSegment[] = [];

  function flushOrigLine() {
    if (currentOrigLine.length > 0) {
      origLines.push(currentOrigLine);
      currentOrigLine = [];
    }
  }

  function flushDraftLine() {
    if (currentDraftLine.length > 0) {
      draftLines.push(currentDraftLine);
      currentDraftLine = [];
    }
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
