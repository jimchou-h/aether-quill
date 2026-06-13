/** 章节摘要写入 Qdrant 时的限速与重试（避免 Embedding 接口 burst 限流） */

export const DEFAULT_CHAPTER_SUMMARY_INDEX_DELAY_MS = 350;
export const DEFAULT_CHAPTER_SUMMARY_INDEX_MAX_RETRIES = 3;
export const DEFAULT_CHAPTER_SUMMARY_INDEX_RETRY_BASE_MS = 600;

export function resolveChapterSummaryIndexDelayMs(value?: string): number {
  const raw = value ?? process.env.CHAPTER_SUMMARY_INDEX_DELAY_MS;
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_CHAPTER_SUMMARY_INDEX_DELAY_MS;
  }
  return Math.min(10_000, n);
}

export function resolveChapterSummaryIndexMaxRetries(value?: string): number {
  const raw = value ?? process.env.CHAPTER_SUMMARY_INDEX_MAX_RETRIES;
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_CHAPTER_SUMMARY_INDEX_MAX_RETRIES;
  }
  return Math.min(8, n);
}

export function resolveChapterSummaryIndexRetryBaseMs(value?: string): number {
  const raw = value ?? process.env.CHAPTER_SUMMARY_INDEX_RETRY_BASE_MS;
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_CHAPTER_SUMMARY_INDEX_RETRY_BASE_MS;
  }
  return Math.min(30_000, n);
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableChapterSummaryIndexError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as {
    response?: { status?: number };
    message?: string;
    code?: string;
  };

  const status = record.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 400) {
    return true;
  }

  const message = String(record.message ?? '').toLowerCase();
  if (
    message.includes('status code 400') ||
    message.includes('status code 429') ||
    message.includes('status code 500') ||
    message.includes('status code 502') ||
    message.includes('status code 503') ||
    message.includes('rate limit') ||
    message.includes('embedding_provider_unavailable')
  ) {
    return true;
  }

  return record.code === 'EMBEDDING_PROVIDER_UNAVAILABLE';
}

export function resolveChapterSummaryIndexRetryDelayMs(
  attempt: number,
  baseMs = resolveChapterSummaryIndexRetryBaseMs()
): number {
  const exp = Math.max(0, attempt);
  return Math.min(30_000, baseMs * 2 ** exp);
}
