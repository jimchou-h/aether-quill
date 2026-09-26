export interface PromptLabCallView {
  id: string;
  kind: 'diagnose' | 'rewrite';
  roundIndex: number;
  windowIndex?: number;
  paragraphIndex?: number;
}

export type PromptLabLayer = 'project_system' | 'diagnose';

export function canOpenPromptLabKind(kind: PromptLabCallView['kind']): boolean {
  return kind === 'diagnose';
}

export interface PromptLabEditors {
  projectSystem: string;
  diagnose: string;
}

export function findPromptLabCall<T extends PromptLabCallView>(
  calls: T[],
  query: {
    kind: 'diagnose' | 'rewrite';
    roundIndex: number;
    windowIndex?: number;
    paragraphIndex?: number;
  }
): T | undefined {
  const windowIndex = query.windowIndex ?? 1;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call || call.kind !== query.kind || call.roundIndex !== query.roundIndex) {
      continue;
    }
    if ((call.windowIndex ?? 1) !== windowIndex) {
      continue;
    }
    if (query.kind === 'rewrite' && call.paragraphIndex !== query.paragraphIndex) {
      continue;
    }
    return call;
  }
  return undefined;
}

export function applyPromptLabSuggestionToLayer(
  current: PromptLabEditors,
  advise: { suggestedText: string } | Error,
  writeTo: PromptLabLayer
): PromptLabEditors {
  if (advise instanceof Error) {
    return current;
  }
  const text = advise.suggestedText.trim();
  if (!text) {
    return current;
  }
  if (writeTo === 'project_system') {
    return { ...current, projectSystem: text };
  }
  return { ...current, diagnose: text };
}
