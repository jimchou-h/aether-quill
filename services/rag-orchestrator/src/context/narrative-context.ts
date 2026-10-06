/**
 * 叙事上下文拼装（AQ-224 / AQ-362 / AQ-365）
 *
 * 按固定顺序拼接多段文本，写入 LLM 的【参考上下文】（与【检索证据】分离）：
 *
 * 1. 【前章衔接】     — 上一章正文尾部（priorChapterTailChars 预算）
 * 2. 【人物当前快照】 — 截至 currentChapterNo-1 的按章人物状态（无出场合并块时）
 * 3. 【近期章节摘要】 — 当前章之前最近 N 章摘要（无摘要时用正文摘录降级）
 * 4. 【语义记忆章节】 — Qdrant 检索历史章节摘要（与近期摘要去重）
 * 5. 【出场人物设定】或回退【人物设定】+【大纲总结】+【关系备忘】（各块可配预算）
 * 6. 【下章衔接】     — 仅章节优化链路：第 N+1 章开头锚点（只读，防抢跑）
 */

import { retrieveMemoryChapterSummaries } from './chapter-summary-memory';
import {
  clampChapterSummaryMemoryCount,
  clampChapterSummaryPromptCount,
  clampContextExcerptMaxChars,
  clampOutlineMaxChars,
  clampPersonaProfileMaxChars,
  clampPriorChapterTailChars,
  clampRelationMemoMaxChars,
  DEFAULT_OUTLINE_MAX_CHARS,
  DEFAULT_PERSONA_PROFILE_MAX_CHARS,
  DEFAULT_RELATION_MEMO_MAX_CHARS,
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
import {
  applyHeadCharBudget,
  applyOutlineBudget,
} from './narrative-budget';
import {
  buildAppearingPersonaInjection,
  type KnowledgeDocForPersonaInject,
} from './appearing-persona-injection';
import {
  recallCrossChapterMemory,
  type ContextEventCard,
} from './cross-chapter-memory';

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
  appearing_persona_injected_count: number;
  outline_budget_mode: 'full' | 'sectioned' | 'truncated' | 'omitted' | null;
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
  outlineMaxChars?: number;
  personaProfileMaxChars?: number;
  relationMemoMaxChars?: number;
  selectedRelationMemory?: string;
  identityRelationMemory?: string;
  currentChapterNo?: number;
  /** 全部人物及其按章快照，用于【人物当前快照】/出场合并注入 */
  personas?: PersonaContextPayload[];
  knowledgeDocuments?: KnowledgeDocForPersonaInject[];
  /** 本章出场人物名单；有值时走合并注入并跳过单一 active persona 全文 */
  appearingCharacters?: string[];
  /** 大纲区段检索 query（通常取本章 structuredMatchingText） */
  outlineMatchingQuery?: string;
  /** 章节优化：注入第 N+1 章开头只读锚点（复用 priorChapterTailChars 预算） */
  includeNextChapterHead?: boolean;
  /** 默认 true。按场成稿关掉：范围内原文 + 前后只读衔接已够。 */
  includePriorChapterSummaries?: boolean;
  /** 默认 true。按场成稿关掉语义记忆摘要。 */
  includeChapterSummaryMemory?: boolean;
  /** 默认 true。按场成稿关掉：角色卡已在检索证据，叙事只留快照。 */
  includeAppearingStaticCards?: boolean;
  /** 事件卡跨章记忆（开关打开时才应传入） */
  eventCards?: ContextEventCard[];
  eventCardMemoryEnabled?: boolean;
  /** 召回 query（优化要求 / 结构匹配文本等） */
  eventCardQueryText?: string;
};

export type NarrativeContextBuildResult = {
  text: string;
  meta: NarrativeContextMeta;
};

function formatPriorPoolEntry(ch: PriorChapterPickResult): string {
  const label = ch.usedExcerptFallback ? '（正文摘录）' : '';
  return `第${ch.chapterNo}章 ${ch.title}${label}: ${ch.summary}`;
}

function resolveAppearingNames(input: NarrativeContextBuildInput): string[] {
  const explicit = (input.appearingCharacters ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 2);
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const chapterNo = input.currentChapterNo;
  if (!chapterNo || chapterNo <= 0) {
    return [];
  }
  const chapter = input.chapters.find((c) => c.chapterNo === chapterNo);
  const haystack = (chapter?.structuredMatchingText ?? '').toLowerCase();
  if (!haystack.trim()) {
    return [];
  }
  const matched: string[] = [];
  for (const persona of input.personas ?? []) {
    const name = persona.name?.trim();
    if (!name || name.length < 2) {
      continue;
    }
    if (haystack.includes(name.toLowerCase())) {
      matched.push(name);
    }
  }
  return matched;
}

function applyRelationMemoBudget(
  identity?: string,
  selected?: string,
  maxChars?: number
): string[] {
  const budget = clampRelationMemoMaxChars(
    maxChars ?? DEFAULT_RELATION_MEMO_MAX_CHARS
  );
  if (budget <= 0) {
    return [];
  }
  const parts: string[] = [];
  if (identity?.trim()) {
    parts.push(identity.trim());
  }
  if (selected?.trim()) {
    parts.push(`【已选关系事件备忘】\n${selected.trim()}`);
  }
  if (parts.length === 0) {
    return [];
  }
  const joined = parts.join('\n\n');
  if (joined.length <= budget) {
    return parts;
  }
  // Prefer keeping identity + truncated selected as one block under budget
  return [applyHeadCharBudget(joined, budget)];
}

export async function buildNarrativeContextText(
  input: NarrativeContextBuildInput
): Promise<NarrativeContextBuildResult> {
  const sections: string[] = [];
  const excerptFallbackChapterNos: number[] = [];

  const tailChars = clampPriorChapterTailChars(input.priorChapterTailChars);
  const excerptMax = clampContextExcerptMaxChars(input.contextExcerptMaxChars);
  const outlineMax = clampOutlineMaxChars(
    input.outlineMaxChars ?? DEFAULT_OUTLINE_MAX_CHARS
  );
  const personaMax = clampPersonaProfileMaxChars(
    input.personaProfileMaxChars ?? DEFAULT_PERSONA_PROFILE_MAX_CHARS
  );
  const currentChapterNo = input.currentChapterNo;
  const appearingNames = resolveAppearingNames(input);

  // §1 前章正文尾部衔接
  let priorTail = resolvePriorChapterTail(input.chapters, currentChapterNo ?? 0, tailChars);
  if (currentChapterNo && currentChapterNo > 1 && !priorTail.skipped && priorTail.text) {
    sections.push(`【前章衔接】\n${priorTail.text}`);
  } else if (currentChapterNo && currentChapterNo > 1 && tailChars > 0) {
    priorTail = { ...priorTail, skipped: true };
  }

  // §1b 跨章事件卡记忆（默认关；打开后才注入，不替换近期摘要）
  if (
    input.eventCardMemoryEnabled &&
    currentChapterNo &&
    currentChapterNo > 0 &&
    (input.eventCards?.length ?? 0) > 0
  ) {
    const recalled = recallCrossChapterMemory({
      cards: input.eventCards ?? [],
      currentChapterNo,
      appearingCharacters: appearingNames,
      queryText: input.eventCardQueryText ?? input.outlineMatchingQuery ?? '',
    });
    if (recalled.blockText) {
      sections.push(recalled.blockText);
    }
  }

  // §5 前置：出场人物合并注入（静态卡 + 动态快照），成功则跳过全局快照与单 active 全文
  const appearingInjection =
    appearingNames.length > 0
      ? buildAppearingPersonaInjection({
          appearingNames,
          personas: input.personas ?? [],
          knowledgeDocuments: input.knowledgeDocuments ?? [],
          currentChapterNo,
          staticCardMaxChars: personaMax,
          includeStaticCard: input.includeAppearingStaticCards,
        })
      : { text: '', injectedNames: [] };

  // §2 人物快照：无出场合并块时注入已发布人物快照；有合并块则快照已含在块内
  let snapshotSection = { text: '', injectedCount: 0, asOfChapterNo: null as number | null };
  if (!appearingInjection.text) {
    snapshotSection = buildPersonaSnapshotSection({
      personas: input.personas ?? [],
      currentChapterNo,
    });
    if (snapshotSection.text) {
      sections.push(snapshotSection.text);
    }
  }

  // §3 近期章节摘要（确定性选取，非向量）
  const includePriorSummaries = input.includePriorChapterSummaries !== false;
  const prior = includePriorSummaries
    ? pickPriorChapterSummariesForPrompt(input.chapters, {
        currentChapterNo,
        maxCount: clampChapterSummaryPromptCount(input.chapterSummaryPromptCount),
        excerptMaxChars: excerptMax,
      })
    : [];
  for (const ch of prior) {
    if (ch.usedExcerptFallback) {
      excerptFallbackChapterNos.push(ch.chapterNo);
    }
  }
  if (prior.length > 0) {
    sections.push(`【近期章节摘要】\n${prior.map(formatPriorPoolEntry).join('\n')}`);
  }

  // §4 语义记忆：用 structuredMatchingText 做 embedding，从 Qdrant 捞相关历史章摘要
  const includeMemory = input.includeChapterSummaryMemory !== false;
  const memoryMax = includeMemory
    ? clampChapterSummaryMemoryCount(input.chapterSummaryMemoryCount)
    : 0;
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

  // §5 静态设定与关系备忘（预算治理）
  if (appearingInjection.text) {
    sections.push(appearingInjection.text);
  } else if (
    input.personaProfile &&
    input.personaProfile !== '未配置人物设定' &&
    personaMax > 0
  ) {
    sections.push(
      `【人物设定】\n${applyHeadCharBudget(input.personaProfile, personaMax)}`
    );
  }

  let outlineBudgetMode: NarrativeContextMeta['outline_budget_mode'] = null;
  if (input.outlineSummary?.trim()) {
    const outline = applyOutlineBudget(
      input.outlineSummary,
      outlineMax,
      input.outlineMatchingQuery
    );
    outlineBudgetMode = outline.mode;
    if (outline.text) {
      const modeHint =
        outline.mode === 'sectioned'
          ? '（已按本章相关区段裁剪）'
          : outline.mode === 'truncated'
            ? '（已按预算截断）'
            : '';
      sections.push(`【大纲总结】${modeHint}\n${outline.text}`);
    }
  }

  sections.push(
    ...applyRelationMemoBudget(
      input.identityRelationMemory,
      input.selectedRelationMemory,
      input.relationMemoMaxChars
    )
  );

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
    appearing_persona_injected_count: appearingInjection.injectedNames.length,
    outline_budget_mode: outlineBudgetMode,
  };

  return { text: sections.join('\n\n'), meta };
}
