import {
  WRITE_CHAPTER_DRAFT_TEMPLATE_KEY,
  WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY,
} from '../retrieval/knowledge-retrieval';
import { logger } from '../observability';
import type { TraceRecord } from './types';

const WRITE_CHAPTER_DRAFT_PHASE = 'write.chapter.draft';

export type WriteChapterPromptKind = 'outline' | 'draft';

export function resolveWriteChapterPromptKind(trace: TraceRecord): WriteChapterPromptKind | null {
  const templateKey =
    typeof trace.context?.templateKey === 'string' ? trace.context.templateKey.trim() : '';
  const phase = typeof trace.context?.phase === 'string' ? trace.context.phase.trim() : '';

  if (templateKey === WRITE_CHAPTER_OUTLINE_TEMPLATE_KEY) {
    return 'outline';
  }
  if (templateKey === WRITE_CHAPTER_DRAFT_TEMPLATE_KEY || phase === WRITE_CHAPTER_DRAFT_PHASE) {
    return 'draft';
  }
  return null;
}

export function isWriteChapterPromptLoggingEnabled(): boolean {
  const raw = process.env.LOG_WRITE_CHAPTER_PROMPT;
  if (raw === undefined || raw.trim() === '') {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

const KIND_LABEL: Record<WriteChapterPromptKind, string> = {
  outline: '生成大纲',
  draft: '生成正文',
};

/**
 * 打印并记录写作工作台「大纲 / 正文」最终拼装 prompt（送入 LLM 的完整 user message）。
 * 可通过 `LOG_WRITE_CHAPTER_PROMPT=false` 关闭。
 */
export function logAssembledWriteChapterPrompt(trace: TraceRecord, prompt: string): void {
  const kind = resolveWriteChapterPromptKind(trace);
  if (!kind || !isWriteChapterPromptLoggingEnabled()) {
    return;
  }

  const label = KIND_LABEL[kind];
  const templateKey =
    typeof trace.context?.templateKey === 'string' ? trace.context.templateKey : undefined;
  const chapterNo = extractChapterNo(trace);

  logger.info('write_chapter_prompt', {
    traceId: trace.id,
    projectId: trace.projectId,
    kind,
    templateKey,
    chapterNo,
    promptChars: prompt.length,
    prompt,
  });

  const header = [
    '',
    '='.repeat(72),
    `[rag-orchestrator] ${label}`,
    `traceId=${trace.id}`,
    `projectId=${trace.projectId}`,
    chapterNo !== undefined ? `chapterNo=${chapterNo}` : null,
    templateKey ? `templateKey=${templateKey}` : null,
    `chars=${prompt.length}`,
    '='.repeat(72),
  ]
    .filter(Boolean)
    .join('\n');

  console.log(`${header}\n${prompt}\n${'='.repeat(72)}\n`);
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
