export type RagServiceRole = 'rag-orchestrator' | 'worker';

export interface ResolvedRagInfrastructureEnv {
  vectorProvider: 'qdrant' | 'pgvector';
  qdrantUrl: string;
  embeddingProvider: 'siliconflow';
  embeddingModel: string;
  siliconflowApiBase: string;
  /** 敏感：仅用于运行时传参，禁止日志输出 */
  siliconflowApiKey: string;
  retrievalTopK: number;
  rerankTopN: number;
  retrievalMinScore: number;
  ingestChunkTokenSize: number;
  ingestChunkTokenOverlap: number;
  ingestSegmenter: 'paragraph-first';
}

const DEFAULT_SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';

function trimEnv(key: string): string {
  return (process.env[key] ?? '').trim();
}

function resolveQdrantUrl(): string {
  const direct = trimEnv('QDRANT_URL');
  if (direct) {
    return direct;
  }
  const host = trimEnv('QDRANT_HOST');
  if (host) {
    const port = trimEnv('QDRANT_PORT') || '6333';
    const protocol = trimEnv('QDRANT_HTTP_SCHEME') || 'http';
    return `${protocol}://${host}:${port}`;
  }
  return '';
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

function parseScore(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${key} must be a number in [0, 1]`);
  }
  return n;
}

function resolveSiliconflowApiKey(): string {
  return trimEnv('SILICONFLOW_API_KEY') || trimEnv('EMBEDDING_API_KEY') || trimEnv('LLM_API_KEY');
}

function resolveSiliconflowApiBase(): string {
  return (
    trimEnv('SILICONFLOW_API_BASE') || trimEnv('EMBEDDING_API_BASE') || DEFAULT_SILICONFLOW_BASE
  );
}

/**
 * 启动期硬校验：Embedding / 向量库 / 检索数值 / Worker 切分相关变量。
 * 本地单测或 CI 仅 build 时可设 `AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION=true`（禁止在生产环境使用）。
 */
export function assertRagInfrastructureEnv(role: RagServiceRole): void {
  if (trimEnv('AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION') === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'AETHER_QUILL_SKIP_RAG_INFRA_ENV_VALIDATION cannot be enabled when NODE_ENV=production'
      );
    }
    return;
  }

  const errors: string[] = [];

  const vectorProvider = (trimEnv('VECTOR_PROVIDER') || 'qdrant').toLowerCase();
  if (vectorProvider !== 'qdrant' && vectorProvider !== 'pgvector') {
    errors.push(`VECTOR_PROVIDER must be "qdrant" or "pgvector", got "${vectorProvider}"`);
  }

  const qdrantUrl = vectorProvider === 'qdrant' ? resolveQdrantUrl() : '';
  if (vectorProvider === 'qdrant' && !qdrantUrl) {
    errors.push('QDRANT_URL is required when VECTOR_PROVIDER=qdrant (or set QDRANT_HOST)');
  }

  const embeddingProvider = trimEnv('EMBEDDING_PROVIDER').toLowerCase();
  if (!embeddingProvider) {
    errors.push('EMBEDDING_PROVIDER is required (V1: use "siliconflow")');
  } else if (embeddingProvider === 'openai-compatible') {
    errors.push(
      'EMBEDDING_PROVIDER=openai-compatible is disabled until V1.5; use EMBEDDING_PROVIDER=siliconflow'
    );
  } else if (embeddingProvider !== 'siliconflow') {
    errors.push(`EMBEDDING_PROVIDER must be "siliconflow" in V1, got "${embeddingProvider}"`);
  }

  const embeddingModel = trimEnv('EMBEDDING_MODEL');
  if (!embeddingModel) {
    errors.push('EMBEDDING_MODEL is required');
  }

  const siliconflowApiKey = resolveSiliconflowApiKey();
  if (!siliconflowApiKey) {
    errors.push(
      'Embedding API key missing: set SILICONFLOW_API_KEY or EMBEDDING_API_KEY or LLM_API_KEY'
    );
  }

  let ingestChunkTokenSize = 700;
  let ingestChunkTokenOverlap = 100;

  try {
    void parsePositiveInt(process.env.RETRIEVAL_TOPK, 30, 'RETRIEVAL_TOPK');
    void parsePositiveInt(process.env.RERANK_TOPN, 10, 'RERANK_TOPN');
    void parseScore(process.env.RETRIEVAL_MIN_SCORE, 0.2, 'RETRIEVAL_MIN_SCORE');
    ingestChunkTokenSize = parsePositiveInt(
      process.env.INGEST_CHUNK_TOKEN_SIZE ?? process.env.INGEST_CHUNK_SIZE,
      700,
      'INGEST_CHUNK_TOKEN_SIZE'
    );
    ingestChunkTokenOverlap = parsePositiveInt(
      process.env.INGEST_CHUNK_TOKEN_OVERLAP ?? process.env.INGEST_CHUNK_OVERLAP,
      100,
      'INGEST_CHUNK_TOKEN_OVERLAP'
    );
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (ingestChunkTokenOverlap >= ingestChunkTokenSize) {
    errors.push('INGEST_CHUNK_TOKEN_OVERLAP must be strictly less than INGEST_CHUNK_TOKEN_SIZE');
  }

  const segmenter = (trimEnv('INGEST_SEGMENTER') || 'paragraph-first').toLowerCase();
  if (segmenter !== 'paragraph-first') {
    errors.push(`INGEST_SEGMENTER must be "paragraph-first" in V1, got "${segmenter}"`);
  }

  if (vectorProvider === 'pgvector') {
    errors.push('VECTOR_PROVIDER=pgvector is not implemented in V1; use VECTOR_PROVIDER=qdrant');
  }

  if (errors.length > 0) {
    const payload = {
      event: 'rag_infrastructure_env_invalid',
      service: role,
      errors,
    };
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
    throw new Error(`RAG infrastructure environment validation failed (${errors.length} issue(s))`);
  }
}

/**
 * 在已通过 {@link assertRagInfrastructureEnv} 后解析运行时配置（勿在未校验时调用）。
 */
export function getResolvedRagInfrastructureEnv(): ResolvedRagInfrastructureEnv {
  const vectorProvider = (trimEnv('VECTOR_PROVIDER') || 'qdrant').toLowerCase() as
    | 'qdrant'
    | 'pgvector';
  return {
    vectorProvider,
    qdrantUrl: resolveQdrantUrl(),
    embeddingProvider: 'siliconflow',
    embeddingModel: trimEnv('EMBEDDING_MODEL'),
    siliconflowApiBase: resolveSiliconflowApiBase(),
    siliconflowApiKey: resolveSiliconflowApiKey(),
    retrievalTopK: parsePositiveInt(process.env.RETRIEVAL_TOPK, 30, 'RETRIEVAL_TOPK'),
    rerankTopN: parsePositiveInt(process.env.RERANK_TOPN, 10, 'RERANK_TOPN'),
    retrievalMinScore: parseScore(process.env.RETRIEVAL_MIN_SCORE, 0.2, 'RETRIEVAL_MIN_SCORE'),
    ingestChunkTokenSize: parsePositiveInt(
      process.env.INGEST_CHUNK_TOKEN_SIZE ?? process.env.INGEST_CHUNK_SIZE,
      700,
      'INGEST_CHUNK_TOKEN_SIZE'
    ),
    ingestChunkTokenOverlap: parsePositiveInt(
      process.env.INGEST_CHUNK_TOKEN_OVERLAP ?? process.env.INGEST_CHUNK_OVERLAP,
      100,
      'INGEST_CHUNK_TOKEN_OVERLAP'
    ),
    ingestSegmenter: 'paragraph-first',
  };
}
