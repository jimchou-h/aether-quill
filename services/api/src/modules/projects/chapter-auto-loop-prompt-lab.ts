/**
 * 自动优化 Prompt 实验室（openspec: add-auto-loop-prompt-lab）
 *
 * 快照挂在循环会话上；顾问只改任务 Prompt 全文，不写小说。
 */

import {
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
} from './chapter-auto-loop.util';

export type AutoLoopPromptLabKind = 'diagnose' | 'rewrite';

export interface AutoLoopPromptLabCall {
  id: string;
  kind: AutoLoopPromptLabKind;
  templateKey: string;
  roundIndex: number;
  windowIndex?: number;
  windowTotal?: number;
  paragraphIndex?: number;
  userPrompt: string;
  taskPromptText: string;
  output: string;
  frozenRetrievedEvidence: string;
  createdAt: string;
}

export type AutoLoopPromptLabLayer = 'project_system' | 'diagnose';

export interface AutoLoopPromptLabAdviseResult {
  suggestedLayer: AutoLoopPromptLabLayer;
  suggestedText: string;
  rationale: string;
}

export const PROMPT_LAB_ADVISOR_SYSTEM = `你是小说写作系统的 Prompt 调参助手。
你只改「项目 system」或「诊断任务 Prompt」，不写小说正文，不改 user 拼装结构。
必须只输出 JSON：{"suggestedLayer":"project_system 或 diagnose","suggestedText":"完整替换全文","rationale":"一两句说明更像哪一层、改了什么"}。
suggestedLayer 只能是 project_system 或 diagnose。不要 Markdown，不要代码围栏。`;

/** 顾问走工具档，禁止复用改写模板（否则会注入文风样本并按写作模型出散文）。 */
export const PROMPT_LAB_ADVISE_TEMPLATE_KEY = 'prompt-lab.advise';

export function makePromptLabCallId(kind: AutoLoopPromptLabKind): string {
  return `lab-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function templateKeyForPromptLabKind(kind: AutoLoopPromptLabKind): string {
  return kind === 'diagnose'
    ? CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY
    : CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY;
}

function matchesPromptLabCall(
  call: AutoLoopPromptLabCall,
  query: {
    kind: AutoLoopPromptLabKind;
    roundIndex: number;
    windowIndex?: number;
    paragraphIndex?: number;
  }
): boolean {
  const windowIndex = query.windowIndex ?? 1;
  if (call.kind !== query.kind || call.roundIndex !== query.roundIndex) {
    return false;
  }
  if ((call.windowIndex ?? 1) !== windowIndex) {
    return false;
  }
  if (query.kind === 'rewrite') {
    return call.paragraphIndex === query.paragraphIndex;
  }
  return true;
}

/** 同窗同轮多次诊断（解析失败重试）时取最后一次。 */
export function findPromptLabCall(
  calls: AutoLoopPromptLabCall[],
  query: {
    kind: AutoLoopPromptLabKind;
    roundIndex: number;
    windowIndex?: number;
    paragraphIndex?: number;
  }
): AutoLoopPromptLabCall | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call && matchesPromptLabCall(call, query)) {
      return call;
    }
  }
  return undefined;
}

export function attachPromptLabCallIds<
  TItem extends {
    paragraphIndex: number;
    resolvedParagraphIndex?: number;
    promptLabCallId?: string;
  },
  TRound extends {
    roundIndex: number;
    windowIndex?: number;
    promptLabCallId?: string;
    items: TItem[];
  },
>(round: TRound, calls: AutoLoopPromptLabCall[]): TRound {
  const diagnose = findPromptLabCall(calls, {
    kind: 'diagnose',
    roundIndex: round.roundIndex,
    windowIndex: round.windowIndex,
  });
  return {
    ...round,
    ...(diagnose ? { promptLabCallId: diagnose.id } : {}),
    items: round.items.map((item) =>
      attachPromptLabCallIdToItem(item, calls, {
        roundIndex: round.roundIndex,
        windowIndex: round.windowIndex,
      })
    ),
  };
}

export function attachPromptLabCallIdToItem<
  TItem extends {
    paragraphIndex: number;
    resolvedParagraphIndex?: number;
    promptLabCallId?: string;
  },
>(
  item: TItem,
  calls: AutoLoopPromptLabCall[],
  query: { roundIndex: number; windowIndex?: number }
): TItem {
  const rewrite = findPromptLabCall(calls, {
    kind: 'rewrite',
    roundIndex: query.roundIndex,
    windowIndex: query.windowIndex,
    paragraphIndex: item.resolvedParagraphIndex ?? item.paragraphIndex,
  });
  return rewrite ? { ...item, promptLabCallId: rewrite.id } : item;
}

export function buildAdviseUserPrompt(input: {
  userPrompt: string;
  originalOutput: string;
  latestReplayOutput?: string;
  projectSystemText: string;
  taskPromptText: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const historyBlock =
    input.history.length === 0
      ? '（无）'
      : input.history
          .map((turn) => `${turn.role === 'user' ? '作者' : '助手'}：${turn.content}`)
          .join('\n');
  const replayBlock = input.latestReplayOutput?.trim()
    ? `\n【最新重跑输出】\n${input.latestReplayOutput.trim()}\n`
    : '\n【最新重跑输出】\n（尚未重跑）\n';
  return `【当前项目 system】\n${input.projectSystemText}\n
【当前诊断 Prompt】\n${input.taskPromptText}\n
【冻住的 user 拼装稿·只读】\n${input.userPrompt}\n
【原输出】\n${input.originalOutput}
${replayBlock}
【对话历史】\n${historyBlock}\n
【作者本轮评点】\n${input.message.trim()}\n`;
}

function parseAdviseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const attempts = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = candidate.slice(start, end + 1);
    if (sliced !== candidate) {
      attempts.push(sliced);
    }
  }
  for (const text of [...attempts]) {
    if (text.includes('\n')) {
      attempts.push(text.replace(/\n/g, '\\n'));
    }
  }
  let lastError: unknown;
  for (const text of attempts) {
    try {
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('顾问未返回可解析的任务 Prompt');
}

export function parseAdviseResponse(raw: string): AutoLoopPromptLabAdviseResult {
  let parsed: unknown;
  try {
    parsed = parseAdviseJson(raw);
  } catch {
    throw new Error('顾问未返回可解析的任务 Prompt');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('顾问未返回可解析的任务 Prompt');
  }
  const record = parsed as Record<string, unknown>;
  const suggestedLayerRaw =
    typeof record.suggestedLayer === 'string' ? record.suggestedLayer.trim() : '';
  if (suggestedLayerRaw !== 'project_system' && suggestedLayerRaw !== 'diagnose') {
    throw new Error('顾问未返回可解析的任务 Prompt');
  }
  const suggestedText =
    (typeof record.suggestedText === 'string' && record.suggestedText.trim()) ||
    (typeof record.taskPromptText === 'string' ? record.taskPromptText.trim() : '');
  if (!suggestedText) {
    throw new Error('顾问未返回可解析的任务 Prompt');
  }
  const rationale = typeof record.rationale === 'string' ? record.rationale.trim() : '';
  return { suggestedLayer: suggestedLayerRaw, suggestedText, rationale };
}

export function applyAdviseToLayer(
  current: { projectSystem: string; diagnose: string },
  advise: AutoLoopPromptLabAdviseResult | Error,
  writeTo: AutoLoopPromptLabLayer
): { projectSystem: string; diagnose: string } {
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

export function buildPromptLabReplayRequest(
  call: AutoLoopPromptLabCall,
  taskPromptText: string,
  projectSystemPromptText?: string
) {
  return {
    prompt: call.userPrompt,
    templateKey: call.templateKey,
    systemPromptOverride: taskPromptText.trim(),
    context: {
      task: call.templateKey,
      frozenRetrievedEvidence: call.frozenRetrievedEvidence,
      ...(call.windowIndex ? { windowIndex: call.windowIndex } : {}),
      ...(call.windowTotal ? { windowTotal: call.windowTotal } : {}),
      ...(projectSystemPromptText !== undefined
        ? { projectSystemPromptOverride: projectSystemPromptText }
        : {}),
    },
  };
}

export function buildPromptLabAdviseRequest(input: {
  userPrompt: string;
  originalOutput: string;
  latestReplayOutput?: string;
  projectSystemText: string;
  taskPromptText: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  return {
    prompt: buildAdviseUserPrompt(input),
    templateKey: PROMPT_LAB_ADVISE_TEMPLATE_KEY,
    systemPromptOverride: PROMPT_LAB_ADVISOR_SYSTEM,
    context: {
      task: PROMPT_LAB_ADVISE_TEMPLATE_KEY,
      frozenRetrievedEvidence: '',
      omitProjectSystemPrompt: true,
    },
  };
}
