/** Fixed chapter summary template for continuity injection + memory embedding. */

export const CHAPTER_SUMMARY_LABEL_PLOT = '情节';
export const CHAPTER_SUMMARY_LABEL_CHARACTERS = '人物';
export const CHAPTER_SUMMARY_LABEL_OPEN_THREADS = '未收线';

/** Soft target range instructed to the model (includes labels). */
export const CHAPTER_SUMMARY_TARGET_MIN_CHARS = 180;
export const CHAPTER_SUMMARY_TARGET_MAX_CHARS = 280;

/** Hard clamp after normalize to keep prompt/memory budgets predictable. */
export const CHAPTER_SUMMARY_HARD_MAX_CHARS = 320;

/** Max excerpt length used inside the fallback `情节` field. */
export const CHAPTER_SUMMARY_FALLBACK_PLOT_MAX_CHARS = 120;

export const CHAPTER_SUMMARY_PENDING_PLACEHOLDER = '待补全';

export type ChapterSummaryFields = {
  plot: string;
  characters: string;
  openThreads: string;
};

function compactLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatChapterSummaryTemplate(fields: ChapterSummaryFields): string {
  return [
    `${CHAPTER_SUMMARY_LABEL_PLOT}：${compactLine(fields.plot)}`,
    `${CHAPTER_SUMMARY_LABEL_CHARACTERS}：${compactLine(fields.characters)}`,
    `${CHAPTER_SUMMARY_LABEL_OPEN_THREADS}：${compactLine(fields.openThreads)}`,
  ].join('\n');
}

function extractLabeledValue(raw: string, label: string): string | null {
  const pattern = new RegExp(`${label}[：:]\\s*([^\\n\\r]+)`, 'u');
  const match = raw.match(pattern);
  if (!match) {
    return null;
  }
  const value = compactLine(match[1] ?? '');
  return value || null;
}

/**
 * Parse free model output into the fixed three fields.
 * Returns null when any required label/value is missing.
 */
export function parseChapterSummaryTemplate(raw: string): ChapterSummaryFields | null {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }

  const plot = extractLabeledValue(text, CHAPTER_SUMMARY_LABEL_PLOT);
  const characters = extractLabeledValue(text, CHAPTER_SUMMARY_LABEL_CHARACTERS);
  const openThreads = extractLabeledValue(text, CHAPTER_SUMMARY_LABEL_OPEN_THREADS);

  if (!plot || !characters || !openThreads) {
    return null;
  }

  return { plot, characters, openThreads };
}

function clampSummaryLength(summary: string): string {
  if (summary.length <= CHAPTER_SUMMARY_HARD_MAX_CHARS) {
    return summary;
  }
  return `${summary.slice(0, CHAPTER_SUMMARY_HARD_MAX_CHARS - 3)}...`;
}

/**
 * Normalize model (or legacy) summary text into the fixed template.
 * Returns null when the text cannot be salvaged.
 */
export function normalizeChapterSummary(raw: string): string | null {
  const fields = parseChapterSummaryTemplate(raw);
  if (!fields) {
    return null;
  }
  return clampSummaryLength(formatChapterSummaryTemplate(fields));
}

/**
 * Rule-based fallback that keeps the same shape as LLM summaries.
 * Plot uses a short content excerpt; other fields mark pending semantic fill.
 */
export function buildFallbackChapterSummary(content: string): string {
  const compact = compactLine(content);
  if (!compact) {
    return formatChapterSummaryTemplate({
      plot: '暂无摘要（章节内容为空）',
      characters: CHAPTER_SUMMARY_PENDING_PLACEHOLDER,
      openThreads: CHAPTER_SUMMARY_PENDING_PLACEHOLDER,
    });
  }

  const plot =
    compact.length > CHAPTER_SUMMARY_FALLBACK_PLOT_MAX_CHARS
      ? `${compact.slice(0, CHAPTER_SUMMARY_FALLBACK_PLOT_MAX_CHARS)}...`
      : compact;

  return formatChapterSummaryTemplate({
    plot,
    characters: CHAPTER_SUMMARY_PENDING_PLACEHOLDER,
    openThreads: CHAPTER_SUMMARY_PENDING_PLACEHOLDER,
  });
}

/** Prompt fragment shared by the orchestrator utility call. */
export function buildChapterSummaryPromptRules(): string[] {
  return [
    '你是一位小说编辑，请为以下章节正文生成中文语义摘要。',
    '必须严格按以下三行模板输出（不得增减行、不得改标签、不得加标题/编号/Markdown）：',
    `${CHAPTER_SUMMARY_LABEL_PLOT}：……`,
    `${CHAPTER_SUMMARY_LABEL_CHARACTERS}：……`,
    `${CHAPTER_SUMMARY_LABEL_OPEN_THREADS}：……`,
    '字段要求：',
    '1. 情节：1–2句，含主要冲突与结果',
    '2. 人物：角色名（状态/着装）；多名用分号分隔；无则写「无」',
    '3. 未收线：伏笔/悬念；无可写「无」',
    `4. 全文（含标签）控制在 ${CHAPTER_SUMMARY_TARGET_MIN_CHARS}~${CHAPTER_SUMMARY_TARGET_MAX_CHARS} 字`,
    '5. 只输出上述三行，不要其他说明',
  ];
}
