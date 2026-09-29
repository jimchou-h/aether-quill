import {
  CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY,
  CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY,
  WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
  WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY,
} from '../retrieval/knowledge-retrieval';
import { logger } from '../observability';
import type { TraceRecord } from './types';

const WRITE_CHAPTER_DRAFT_PHASE = 'write.chapter.draft';

export type GenerationPromptLogKind =
  | 'outline'
  | 'draft'
  | 'optimize-plan'
  | 'optimize-draft';

/** @deprecated 使用 GenerationPromptLogKind */
export type WriteChapterPromptKind = GenerationPromptLogKind;

export function resolveGenerationPromptLogKind(
  trace: TraceRecord
): GenerationPromptLogKind | null {
  const templateKey =
    typeof trace.context?.templateKey === 'string' ? trace.context.templateKey.trim() : '';
  const phase = typeof trace.context?.phase === 'string' ? trace.context.phase.trim() : '';

  if (templateKey === WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY) {
    return 'outline';
  }
  if (templateKey === WRITE_CHAPTER_DRAFT_TEMPLATE_KEY || phase === WRITE_CHAPTER_DRAFT_PHASE) {
    return 'draft';
  }
  if (templateKey === CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY) {
    return 'optimize-plan';
  }
  if (templateKey === CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY) {
    return 'optimize-draft';
  }
  if (templateKey === 'chapter.optimize.direct-draft') {
    return 'optimize-draft';
  }
  if (
    templateKey === 'chapter.optimize.workbench-draft-sex' ||
    templateKey === 'chapter.optimize.workbench-draft-prose' ||
    templateKey === 'chapter.optimize.workbench-fix-span'
  ) {
    return 'optimize-draft';
  }
  return null;
}

/** @deprecated 使用 resolveGenerationPromptLogKind */
export const resolveWriteChapterPromptKind = resolveGenerationPromptLogKind;

export function isGenerationPromptLoggingEnabled(): boolean {
  return resolveGenerationPromptLogMode() !== 'off';
}

export function isGenerationPromptFullLoggingEnabled(): boolean {
  return resolveGenerationPromptLogMode() === 'full';
}

export type GenerationPromptLogMode = 'off' | 'summary' | 'full';

/** 默认只打字数摘要；true/full 打全文；false 关闭。 */
export function resolveGenerationPromptLogMode(): GenerationPromptLogMode {
  const raw = (process.env.LOG_GENERATION_PROMPT ?? process.env.LOG_WRITE_CHAPTER_PROMPT ?? '')
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return 'off';
  }
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes' || raw === 'full') {
    return 'full';
  }
  return 'summary';
}

/** @deprecated 使用 isGenerationPromptLoggingEnabled */
export const isWriteChapterPromptLoggingEnabled = isGenerationPromptLoggingEnabled;

const KIND_LABEL: Record<GenerationPromptLogKind, string> = {
  outline: '生成大纲',
  draft: '生成正文',
  'optimize-plan': '优化生成方案',
  'optimize-draft': '优化生成正文',
};

/**
 * 打印写作工作台 / 章节优化送入 LLM 的 prompt 摘要。
 * 默认只打字数；`LOG_GENERATION_PROMPT=true` 才输出全文（会拖慢 Windows 终端）。
 */
export function logAssembledGenerationPrompt(
  trace: TraceRecord,
  userMessage: string,
  systemMessage?: string
): void {
  const kind = resolveGenerationPromptLogKind(trace);
  const mode = resolveGenerationPromptLogMode();
  if (!kind || mode === 'off') {
    return;
  }

  const label = KIND_LABEL[kind];
  const templateKey =
    typeof trace.context?.templateKey === 'string' ? trace.context.templateKey : undefined;
  const task = extractTaskName(trace);
  const chapterNo = extractChapterNo(trace);
  const systemText = typeof systemMessage === 'string' ? systemMessage.trim() : '';
  const dumpFull = mode === 'full';

  logger.info('generation_prompt', {
    traceId: trace.id,
    projectId: trace.projectId,
    kind,
    templateKey,
    task,
    chapterNo,
    systemChars: systemText.length,
    userChars: userMessage.length,
    ...(dumpFull
      ? { systemMessage: systemText || undefined, userMessage }
      : {}),
  });

  const header = [
    '',
    '='.repeat(72),
    `[rag-orchestrator] ${label}`,
    `traceId=${trace.id}`,
    `projectId=${trace.projectId}`,
    chapterNo !== undefined ? `chapterNo=${chapterNo}` : null,
    templateKey ? `templateKey=${templateKey}` : null,
    task ? `task=${task}` : null,
    `systemChars=${systemText.length}`,
    `userChars=${userMessage.length}`,
    dumpFull ? null : '（摘要；全文请设 LOG_GENERATION_PROMPT=true）',
    '='.repeat(72),
  ]
    .filter(Boolean)
    .join('\n');

  if (!dumpFull) {
    console.log(`${header}\n`);
    return;
  }

  const body = systemText
    ? `【system】\n${systemText}\n\n【user】\n${userMessage}`
    : userMessage;

  console.log(`${header}\n${body}\n${'='.repeat(72)}\n`);
}

/** 打印分步精修等任务的 LLM 原始返回（与 logAssembledGenerationPrompt 配套） */
export function logGenerationResponse(trace: TraceRecord, content: string): void {
  const kind = resolveGenerationPromptLogKind(trace);
  const mode = resolveGenerationPromptLogMode();
  if (!kind || mode === 'off') {
    return;
  }

  const label = KIND_LABEL[kind];
  const templateKey =
    typeof trace.context?.templateKey === 'string' ? trace.context.templateKey : undefined;
  const responseText = typeof content === 'string' ? content.trim() : '';
  const dumpFull = mode === 'full';

  logger.info('generation_response', {
    traceId: trace.id,
    projectId: trace.projectId,
    kind,
    templateKey,
    responseChars: responseText.length,
    ...(dumpFull ? { response: responseText || undefined } : {}),
  });

  const header = [
    '',
    '='.repeat(72),
    `[rag-orchestrator] ${label} · LLM 返回`,
    `traceId=${trace.id}`,
    `projectId=${trace.projectId}`,
    templateKey ? `templateKey=${templateKey}` : null,
    `responseChars=${responseText.length}`,
    dumpFull ? null : '（摘要；全文请设 LOG_GENERATION_PROMPT=true）',
    '='.repeat(72),
  ]
    .filter(Boolean)
    .join('\n');

  if (!dumpFull) {
    console.log(`${header}\n`);
    return;
  }

  console.log(`${header}\n【response】\n${responseText}\n${'='.repeat(72)}\n`);
}

/** @deprecated 使用 logAssembledGenerationPrompt */
export const logAssembledWriteChapterPrompt = logAssembledGenerationPrompt;

function extractTaskName(trace: TraceRecord): string | undefined {
  const task = trace.context?.task;
  if (typeof task === 'string' && task.trim()) {
    return task.trim();
  }
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    const name = (task as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) {
      return name.trim();
    }
  }
  return undefined;
}

function extractChapterNo(trace: TraceRecord): number | undefined {
  const task = trace.context?.task;
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    const n = Number((task as Record<string, unknown>).chapterNo);
    if (Number.isFinite(n) && n > 0) {
      return Math.trunc(n);
    }
  }
  const extra = Number(trace.context?.chapterNo);
  if (Number.isFinite(extra) && extra > 0) {
    return Math.trunc(extra);
  }
  return undefined;
}
