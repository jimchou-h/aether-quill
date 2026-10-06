/**
 * 跨章事件卡召回（与 api `event-card.util` recall 语义对齐）。
 * 由 narrative-context 在开关打开时注入【跨章记忆】。
 */

export type EventCardKind =
  | 'foreshadow'
  | 'relation'
  | 'ability'
  | 'promise'
  | 'object'
  | 'other';

export type EventCardStatus = 'open' | 'paid' | 'fact';

export type ContextEventCard = {
  id: string;
  chapterNo: number;
  beat: string;
  entities: string[];
  kind: EventCardKind;
  status: EventCardStatus;
  evidence?: string;
  deletedAt?: string | null;
};

export const DEFAULT_EVENT_CARD_TOP_K = 8;
export const MAX_CROSS_CHAPTER_MEMORY_CHARS = 1500;
export const MAX_EVENT_CARD_EVIDENCE_IN_PROMPT = 150;

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max);
}

function normalizeQueryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function scoreEventCard(
  card: ContextEventCard,
  input: {
    currentChapterNo: number;
    appearingCharacters: string[];
    queryText: string;
  }
): number {
  if (card.deletedAt) {
    return -Infinity;
  }
  if (card.chapterNo === input.currentChapterNo) {
    return -Infinity;
  }

  let score = 0;
  const appearing = new Set(
    input.appearingCharacters.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 1)
  );
  const entityHit = (card.entities ?? []).some((e) => appearing.has(e.trim().toLowerCase()));
  if (appearing.size > 0) {
    score += entityHit ? 40 : -15;
  }

  const q = normalizeQueryText(input.queryText);
  const hay = normalizeQueryText(
    `${card.beat} ${card.evidence ?? ''} ${(card.entities ?? []).join(' ')}`
  );
  if (q.length >= 2) {
    let hits = 0;
    for (let i = 0; i < q.length - 1; i++) {
      if (hay.includes(q.slice(i, i + 2))) {
        hits += 1;
      }
    }
    score += Math.min(35, hits);
  }

  if (card.status === 'open') {
    score += 18;
  }
  if (card.kind === 'ability' || card.kind === 'promise') {
    score += 10;
  }
  if (card.kind === 'foreshadow' && card.status === 'open') {
    score += 8;
  }
  if (card.chapterNo === input.currentChapterNo - 1) {
    score += 12;
  }
  return score;
}

export function recallCrossChapterMemory(input: {
  cards: readonly ContextEventCard[];
  currentChapterNo: number;
  appearingCharacters?: string[];
  queryText?: string;
  topK?: number;
}): { blockText: string; usedIds: string[] } {
  const topK = Math.max(1, Math.min(12, Math.floor(input.topK ?? DEFAULT_EVENT_CARD_TOP_K)));
  const appearingCharacters = input.appearingCharacters ?? [];
  const queryText = (input.queryText ?? '').trim();

  const ranked = input.cards
    .map((card) => ({
      card,
      score: scoreEventCard(card, {
        currentChapterNo: input.currentChapterNo,
        appearingCharacters,
        queryText,
      }),
    }))
    .filter((row) => Number.isFinite(row.score) && row.score > 0)
    .sort((a, b) => b.score - a.score || b.card.chapterNo - a.card.chapterNo);

  const selected: ContextEventCard[] = [];
  const header = '【跨章记忆 · 已自动挑选，按相关性排序】\n';
  const footer =
    '\n【使用规则】只作事实约束；未列出的旧情节禁止凭空发明；回扣用动作/对白落地，勿复述证据原文。';
  let usedChars = header.length + footer.length;

  for (const row of ranked) {
    if (selected.length >= topK) {
      break;
    }
    const evidence = truncate(row.card.evidence ?? '', MAX_EVENT_CARD_EVIDENCE_IN_PROMPT);
    const line = `${selected.length + 1}. [第${row.card.chapterNo}章·${row.card.kind}·${row.card.status}] ${row.card.beat}${
      evidence ? ` 证据：「${evidence}」` : ''
    }`;
    if (usedChars + line.length + 1 > MAX_CROSS_CHAPTER_MEMORY_CHARS) {
      break;
    }
    selected.push(row.card);
    usedChars += line.length + 1;
  }

  if (selected.length === 0) {
    return { blockText: '', usedIds: [] };
  }

  const lines = selected.map((card, index) => {
    const evidence = truncate(card.evidence ?? '', MAX_EVENT_CARD_EVIDENCE_IN_PROMPT);
    return `${index + 1}. [第${card.chapterNo}章·${card.kind}·${card.status}] ${card.beat}${
      evidence ? ` 证据：「${evidence}」` : ''
    }`;
  });

  return {
    blockText: `${header}${lines.join('\n')}${footer}`,
    usedIds: selected.map((c) => c.id),
  };
}
