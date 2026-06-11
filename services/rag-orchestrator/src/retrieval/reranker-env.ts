export const DEFAULT_RERANK_VECTOR_WEIGHT = 0.7;
export const DEFAULT_RERANK_LEXICAL_WEIGHT = 0.3;
export const DEFAULT_RERANK_MAX_PER_DOC = 1;

function parseUnitWeight(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${key} must be a number in [0, 1]`);
  }
  return n;
}

function parsePositiveInt(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return n;
}

export function resolveRerankWeightsFromEnv(): {
  vectorWeight: number;
  lexicalWeight: number;
} {
  return {
    vectorWeight: parseUnitWeight(
      process.env.RERANK_VECTOR_WEIGHT,
      DEFAULT_RERANK_VECTOR_WEIGHT,
      'RERANK_VECTOR_WEIGHT'
    ),
    lexicalWeight: parseUnitWeight(
      process.env.RERANK_LEXICAL_WEIGHT,
      DEFAULT_RERANK_LEXICAL_WEIGHT,
      'RERANK_LEXICAL_WEIGHT'
    ),
  };
}

export function resolveRerankMaxPerDocFromEnv(): number {
  return parsePositiveInt(
    process.env.RERANK_MAX_PER_DOC,
    DEFAULT_RERANK_MAX_PER_DOC,
    'RERANK_MAX_PER_DOC'
  );
}
