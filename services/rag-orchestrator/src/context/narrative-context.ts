/** AQ-224：分层叙事上下文拼装（前章衔接 + 近期摘要 + 语义记忆） */

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
import { resolvePriorChapterTail } from './prior-chapter-tail';
import { resolveMemoryChapterSummaryEmbeddingQuery } from '../retrieval/knowledge-retrieval';

export type NarrativeContextMeta = {
  prior_chapter_tail_injected: boolean;
  prior_chapter_tail_chars: number;
  prior_chapter_tail_skipped: boolean;
  excerpt_fallback_chapter_nos: number[];
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
  currentChapterNo?: number;
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

  let priorTail = resolvePriorChapterTail(input.chapters, currentChapterNo ?? 0, tailChars);
  if (currentChapterNo && currentChapterNo > 1 && !priorTail.skipped && priorTail.text) {
    sections.push(`【前章衔接】\n${priorTail.text}`);
  } else if (currentChapterNo && currentChapterNo > 1 && tailChars > 0) {
    priorTail = { ...priorTail, skipped: true };
  }

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

  if (input.personaProfile && input.personaProfile !== '未配置人物设定') {
    sections.push(`【人物设定】\n${input.personaProfile}`);
  }
  if (input.outlineSummary?.trim()) {
    sections.push(`【大纲总结】\n${input.outlineSummary.trim()}`);
  }
  if (input.selectedRelationMemory?.trim()) {
    sections.push(`【已选关系事件备忘】\n${input.selectedRelationMemory.trim()}`);
  }

  const meta: NarrativeContextMeta = {
    prior_chapter_tail_injected: Boolean(priorTail.text && !priorTail.skipped),
    prior_chapter_tail_chars: priorTail.chars,
    prior_chapter_tail_skipped: priorTail.skipped,
    excerpt_fallback_chapter_nos: excerptFallbackChapterNos,
  };

  return { text: sections.join('\n\n'), meta };
}
