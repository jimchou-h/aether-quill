/**
 * 事件卡（跨章记忆）纯函数：解析抽取结果、召回排序、注入文本拼装。
 * AQ-375 ~ AQ-377 — 不改动章节改写主契约。
 */

export const EVENT_CARD_KINDS = [
  'foreshadow',
  'relation',
  'ability',
  'promise',
  'object',
  'other',
] as const;
export type EventCardKind = (typeof EVENT_CARD_KINDS)[number];

export const EVENT_CARD_STATUSES = ['open', 'paid', 'fact'] as const;
export type EventCardStatus = (typeof EVENT_CARD_STATUSES)[number];

export const EVENT_CARD_SOURCES = ['auto', 'user_edit'] as const;
export type EventCardSource = (typeof EVENT_CARD_SOURCES)[number];

export const MAX_EVENT_CARD_BEAT_CHARS = 80;
export const MAX_EVENT_CARD_EVIDENCE_CHARS = 200;
export const DEFAULT_EVENT_CARD_TOP_K = 8;
export const MAX_EVENT_CARD_TOP_K = 12;
export const MAX_CROSS_CHAPTER_MEMORY_CHARS = 1500;
export const MAX_EVENT_CARD_EVIDENCE_IN_PROMPT = 150;

export interface EventCardRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  beat: string;
  entities: string[];
  kind: EventCardKind;
  status: EventCardStatus;
  evidence: string;
  source: EventCardSource;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface EventCardCandidate {
  beat: string;
  entities: string[];
  kind: EventCardKind;
  status: EventCardStatus;
  evidence: string;
}

export interface UsedEventCardRef {
  id: string;
  chapterNo: number;
  beat: string;
  kind: EventCardKind;
  status: EventCardStatus;
}

export function isEventCardKind(value: unknown): value is EventCardKind {
  return typeof value === 'string' && (EVENT_CARD_KINDS as readonly string[]).includes(value);
}

export function isEventCardStatus(value: unknown): value is EventCardStatus {
  return typeof value === 'string' && (EVENT_CARD_STATUSES as readonly string[]).includes(value);
}

export function clampEventCardTopK(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_EVENT_CARD_TOP_K;
  }
  return Math.max(1, Math.min(MAX_EVENT_CARD_TOP_K, Math.floor(n)));
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max);
}

function normalizeEntities(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const name = item.trim();
    if (name.length < 1 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out.slice(0, 12);
}

function defaultStatusForKind(kind: EventCardKind): EventCardStatus {
  if (kind === 'foreshadow' || kind === 'promise') {
    return 'open';
  }
  return 'fact';
}

export function parseExtractedEventCardCandidates(raw: unknown): EventCardCandidate[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { cards?: unknown }).cards)
      ? ((raw as { cards: unknown[] }).cards ?? [])
      : [];

  const out: EventCardCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const beat = truncate(String(record.beat ?? record.summary ?? ''), MAX_EVENT_CARD_BEAT_CHARS);
    if (!beat) {
      continue;
    }
    const kind = isEventCardKind(record.kind) ? record.kind : 'other';
    const status = isEventCardStatus(record.status)
      ? record.status
      : defaultStatusForKind(kind);
    const evidence = truncate(
      String(record.evidence ?? record.evidenceSnippet ?? ''),
      MAX_EVENT_CARD_EVIDENCE_CHARS
    );
    out.push({
      beat,
      entities: normalizeEntities(record.entities ?? record.actors),
      kind,
      status,
      evidence,
    });
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

/**
 * 本章 auto 卡 soft-delete 后写入新 auto 卡；user_edit 保留。返回新数组（不 mutate 入参）。
 */
export function mergeEventCardsAfterExtract(input: {
  existing: readonly EventCardRecord[];
  projectId: string;
  chapterNo: number;
  candidates: EventCardCandidate[];
  now?: Date;
  idFactory?: () => string;
}): EventCardRecord[] {
  const now = input.now ?? new Date();
  const makeId =
    input.idFactory ??
    (() => `ec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

  const preserved = input.existing.map((card) => {
    if (
      card.chapterNo === input.chapterNo &&
      card.source === 'auto' &&
      card.deletedAt === null
    ) {
      return { ...card, deletedAt: now, updatedAt: now };
    }
    return { ...card };
  });

  const created: EventCardRecord[] = input.candidates.map((candidate) => ({
    id: makeId(),
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    beat: candidate.beat,
    entities: [...candidate.entities],
    kind: candidate.kind,
    status: candidate.status,
    evidence: candidate.evidence,
    source: 'auto' as const,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  return [...preserved, ...created];
}

function normalizeQueryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function scoreEventCard(
  card: EventCardRecord,
  input: {
    currentChapterNo: number;
    appearingCharacters: string[];
    queryText: string;
  }
): number {
  if (card.deletedAt) {
    return -Infinity;
  }
  // 不召回「当前正在写的这一章」自己的卡（避免复读本章）
  if (card.chapterNo === input.currentChapterNo) {
    return -Infinity;
  }

  let score = 0;
  const appearing = new Set(
    input.appearingCharacters.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 1)
  );
  const entityHit = card.entities.some((e) => appearing.has(e.trim().toLowerCase()));
  if (appearing.size > 0) {
    score += entityHit ? 40 : -15;
  }

  const q = normalizeQueryText(input.queryText);
  const hay = normalizeQueryText(`${card.beat} ${card.evidence} ${card.entities.join(' ')}`);
  if (q.length >= 2) {
    // cheap char bigram overlap
    let hits = 0;
    for (let i = 0; i < q.length - 1; i++) {
      const gram = q.slice(i, i + 2);
      if (hay.includes(gram)) {
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
  cards: readonly EventCardRecord[];
  currentChapterNo: number;
  appearingCharacters?: string[];
  queryText?: string;
  topK?: number;
}): { selected: EventCardRecord[]; used: UsedEventCardRef[]; blockText: string } {
  const topK = clampEventCardTopK(input.topK);
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

  const selected: EventCardRecord[] = [];
  let usedChars = 0;
  const header = '【跨章记忆 · 已自动挑选，按相关性排序】\n';
  const footer =
    '\n【使用规则】只作事实约束；未列出的旧情节禁止凭空发明；回扣用动作/对白落地，勿复述证据原文。';
  usedChars += header.length + footer.length;

  for (const row of ranked) {
    if (selected.length >= topK) {
      break;
    }
    const evidence = truncate(row.card.evidence, MAX_EVENT_CARD_EVIDENCE_IN_PROMPT);
    const line = `${selected.length + 1}. [第${row.card.chapterNo}章·${row.card.kind}·${row.card.status}] ${row.card.beat}${
      evidence ? ` 证据：「${evidence}」` : ''
    }`;
    if (usedChars + line.length + 1 > MAX_CROSS_CHAPTER_MEMORY_CHARS) {
      break;
    }
    selected.push(row.card);
    usedChars += line.length + 1;
  }

  const used: UsedEventCardRef[] = selected.map((card) => ({
    id: card.id,
    chapterNo: card.chapterNo,
    beat: card.beat,
    kind: card.kind,
    status: card.status,
  }));

  if (selected.length === 0) {
    return { selected, used, blockText: '' };
  }

  const lines = selected.map((card, index) => {
    const evidence = truncate(card.evidence, MAX_EVENT_CARD_EVIDENCE_IN_PROMPT);
    return `${index + 1}. [第${card.chapterNo}章·${card.kind}·${card.status}] ${card.beat}${
      evidence ? ` 证据：「${evidence}」` : ''
    }`;
  });

  return {
    selected,
    used,
    blockText: `${header}${lines.join('\n')}${footer}`,
  };
}

export function assertEventCardBeat(beat: string): void {
  const t = beat.trim();
  if (!t) {
    throw new Error('事件卡 beat 不能为空');
  }
  if (t.length > MAX_EVENT_CARD_BEAT_CHARS) {
    throw new Error(`事件卡 beat 不能超过 ${MAX_EVENT_CARD_BEAT_CHARS} 字`);
  }
}
