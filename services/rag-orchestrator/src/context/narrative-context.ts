/**
 * 叙事上下文拼装（AQ-224）
 *
 * 按固定顺序拼接多段文本，写入 LLM 的【叙事上下文】（与【检索证据】分离）：
 *
 * 1. 【前章衔接】     — 上一章正文尾部（priorChapterTailChars 预算）
 * 2. 【人物当前快照】 — 截至 currentChapterNo-1 的按章人物状态
 * 3. 【近期章节摘要】 — 当前章之前最近 N 章摘要（无摘要时用正文摘录降级）
 * 4. 【语义记忆章节】 — Qdrant 检索历史章节摘要（与近期摘要去重）
 * 5. 【人物设定】【大纲总结】【关系备忘】
 * 6. 【下章衔接】     — 仅章节优化链路：第 N+1 章开头锚点（只读，防抢跑）
 */

import { retrieveMemoryChapterSummaries } from './chapter-summary-memory';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampPriorChapterTailChars,
} from './generation-preferences';
import {
  pickPriorChapterSummariesForPrompt,
  type ChapterSummaryInput,
  type PriorChapterPickResult,
} from './prior-chapter-summaries';
import { resolveNextChapterHead } from './next-chapter-head';
import { resolvePriorChapterTail } from './prior-chapter-tail';
import { resolveMemoryChapterSummaryEmbeddingQuery } from '../retrieval/knowledge-retrieval';
import {
  buildPersonaSnapshotSection,
  type PersonaContextPayload,
} from './persona-snapshot';

export type NarrativeContextMeta = {
  prior_chapter_tail_injected: boolean;
  prior_chapter_tail_chars: number;
  prior_chapter_tail_skipped: boolean;
  next_chapter_head_injected: boolean;
  next_chapter_head_chars: number;
  next_chapter_head_skipped: boolean;
  excerpt_fallback_chapter_nos: number[];
  persona_snapshot_injected_count: number;
  persona_snapshot_as_of_chapter: number | null;
};

export type NarrativeContextBuildInput = {
  projectId: string;
  personaProfile: string;
  outlineSummary: string;
  chapters: ChapterSummaryInput[];
  chapterSummaryPromptCount: number;
  chapterSummaryMemoryCount: number;
  priorChapterTailChars: number;
  contextExcerptMaxChars: number;
  selectedRelationMemory?: string;
  identityRelationMemory?: string;
  currentChapterNo?: number;
  /** 全部人物及其按章快照，用于【人物当前快照】段 */
  personas?: PersonaContextPayload[];
  /** 章节优化：注入第 N+1 章开头只读锚点（复用 priorChapterTailChars 预算） */
  includeNextChapterHead?: boolean;
};

export type NarrativeContextBuildResult = {
  text: string;
  meta: NarrativeContextMeta;
};

function formatPriorPoolEntry(ch: PriorChapterPickResult): string {
  const label = ch.usedExcerptFallback ? '（正文摘录）' : '';
  return `第${ch.chapterNo}章 ${ch.title}${label}: ${ch.summary}`;
}

export async function buildNarrativeContextText(
  input: NarrativeContextBuildInput
): Promise<NarrativeContextBuildResult> {
  const sections: string[] = [];
  const excerptFallbackChapterNos: number[] = [];

  const tailChars = clampPriorChapterTailChars(input.priorChapterTailChars);
  const excerptMax = clampContextExcerptMaxChars(input.contextExcerptMaxChars);
  const currentChapterNo = input.currentChapterNo;

  // §1 前章正文尾部衔接
  let priorTail = resolvePriorChapterTail(input.chapters, currentChapterNo ?? 0, tailChars);
  if (currentChapterNo && currentChapterNo > 1 && !priorTail.skipped && priorTail.text) {
    sections.push(`【前章衔接】\n${priorTail.text}`);
  } else if (currentChapterNo && currentChapterNo > 1 && tailChars > 0) {
    priorTail = { ...priorTail, skipped: true };
  }

  // §2 人物快照（截至写本章前的最新按章状态）
  const snapshotSection = buildPersonaSnapshotSection({
    personas: input.personas ?? [],
    currentChapterNo,
  });
  if (snapshotSection.text) {
    sections.push(snapshotSection.text);
  }

  // §3 近期章节摘要（确定性选取，非向量）
  const maxCount = clampChapterSummaryPromptCount(input.chapterSummaryPromptCount);
  const prior = pickPriorChapterSummariesForPrompt(input.chapters, {
    currentChapterNo,
    maxCount,
    excerptMaxChars: excerptMax,
  });
  for (const ch of prior) {
    if (ch.usedExcerptFallback) {
      excerptFallbackChapterNos.push(ch.chapterNo);
    }
  }
  if (prior.length > 0) {
    sections.push(`【近期章节摘要】\n${prior.map(formatPriorPoolEntry).join('\n')}`);
  }

  // §4 语义记忆：用 structuredMatchingText 做 embedding，从 Qdrant 捞相关历史章摘要
  const memoryMax = clampChapterSummaryMemoryCount(input.chapterSummaryMemoryCount);
  if (memoryMax > 0) {
    const memoryQuery = resolveMemoryChapterSummaryEmbeddingQuery({
      currentChapterNo,
      chapters: input.chapters,
    });
    if (memoryQuery) {
      const memory = await retrieveMemoryChapterSummaries(input.projectId, memoryQuery, {
        currentChapterNo,
        maxCount: memoryMax,
        excludeChapterNos: prior.map((ch) => ch.chapterNo),
      });
      if (memory.length > 0) {
        sections.push(
          `【语义记忆章节】\n${memory
            .map((ch) => `第${ch.chapterNo}章 ${ch.title}: ${ch.summary}`)
            .join('\n')}`
        );
      }
    }
  }

  // §5 静态设定与关系备忘
  if (input.personaProfile && input.personaProfile !== '未配置人物设定') {
    sections.push(`【人物设定】\n${input.personaProfile}`);
  }
  if (input.outlineSummary?.trim()) {
    sections.push(`【大纲总结】\n${input.outlineSummary.trim()}`);
  }
  if (input.identityRelationMemory?.trim()) {
    sections.push(input.identityRelationMemory.trim());
  }
  if (input.selectedRelationMemory?.trim()) {
    sections.push(`【已选关系事件备忘】\n${input.selectedRelationMemory.trim()}`);
  }

  // §6 下章开头锚点（章节优化专用，防止改写时与下章冲突）
  let nextHead = resolveNextChapterHead(input.chapters, currentChapterNo ?? 0, tailChars);
  if (input.includeNextChapterHead && currentChapterNo && !nextHead.skipped && nextHead.text) {
    sections.push(
      `【下章衔接】（第${nextHead.chapterNo}章开头只读锚点，改写本章末勿与之矛盾，勿提前写入下章情节）\n${nextHead.text}`
    );
  } else if (input.includeNextChapterHead && currentChapterNo && tailChars > 0) {
    nextHead = { ...nextHead, skipped: true };
  }

  const meta: NarrativeContextMeta = {
    prior_chapter_tail_injected: Boolean(priorTail.text && !priorTail.skipped),
    prior_chapter_tail_chars: priorTail.chars,
    prior_chapter_tail_skipped: priorTail.skipped,
    next_chapter_head_injected: Boolean(
      input.includeNextChapterHead && nextHead.text && !nextHead.skipped
    ),
    next_chapter_head_chars: nextHead.chars,
    next_chapter_head_skipped: nextHead.skipped,
    excerpt_fallback_chapter_nos: excerptFallbackChapterNos,
    persona_snapshot_injected_count: snapshotSection.injectedCount,
    persona_snapshot_as_of_chapter: snapshotSection.asOfChapterNo,
  };

  return { text: sections.join('\n\n'), meta };
}
