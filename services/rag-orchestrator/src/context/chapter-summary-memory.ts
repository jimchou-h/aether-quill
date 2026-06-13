/**
 * 章节摘要语义记忆 — Qdrant 独立点位
 *
 * - **写入**：API 在「生成摘要」、章节正文保存/优化应用后调用 `indexChapterSummaryInQdrant`
 * - **读取**：`buildNarrativeContextText` 通过 `retrieveMemoryChapterSummaries` 按当前写作意图检索相关历史章
 *
 * 与「近期章节摘要」区别：近期是确定性取最近 N 章；语义记忆是向量相似度补充，且排除已注入的近期章。
 */

import { getEmbeddingProvider } from '@aether-quill/model-providers';
import { createHash } from 'node:crypto';
import {
  createQdrantClientFromEnv,
  ensureProjectChunkCollection,
  projectChunksCollectionName,
} from '../retrieval/qdrant-client';
import { getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import { MEMORY_CHAPTER_SUMMARY_EMBED_MAX_CHARS } from '../retrieval/knowledge-retrieval';
import type { ChapterSummaryInput } from './prior-chapter-summaries';

export const CHAPTER_SUMMARY_DOC_TYPE = 'chapter_summary';

function stablePointId(projectId: string, chapterNo: number): string {
  const hex = createHash('sha256')
    .update(`${projectId}::chapter-summary::${chapterNo}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function indexChapterSummaryInQdrant(input: {
  projectId: string;
  chapterNo: number;
  title: string;
  summary: string;
}): Promise<void> {
  const summary = input.summary.trim();
  if (!summary) {
    return;
  }

  const env = getResolvedRagInfrastructureEnv();
  const client = createQdrantClientFromEnv(env);
  const collection = projectChunksCollectionName(input.projectId);
  const documentId = `chapter-summary:${input.chapterNo}`;

  const provider = getEmbeddingProvider();
  const { embeddings } = await provider.embed([summary]);
  const vector = embeddings[0];
  if (!vector?.length) {
    return;
  }

  await ensureProjectChunkCollection(client, collection, vector.length);

  await client.delete(collection, {
    filter: {
      must: [{ key: 'document_id', match: { value: documentId } }],
    },
  });

  const now = new Date().toISOString();
  await client.upsert(collection, {
    wait: true,
    points: [
      {
        id: stablePointId(input.projectId, input.chapterNo),
        vector,
        payload: {
          project_id: input.projectId,
          document_id: documentId,
          document_type: CHAPTER_SUMMARY_DOC_TYPE,
          doc_type: CHAPTER_SUMMARY_DOC_TYPE,
          chunk_id: `${documentId}:0`,
          chapter_no: input.chapterNo,
          content: summary,
          docTitle: input.title,
          section: 'summary',
          language: (process.env.DEFAULT_LANGUAGE || 'zh').trim() || 'zh',
          created_at: now,
          embedding: vector,
        },
      },
    ],
  });
}

export type MemoryChapterSummaryRetrieveOpts = {
  currentChapterNo?: number;
  maxCount: number;
  /** 已在「近期章节摘要」池中的章号，语义记忆池不再重复注入 */
  excludeChapterNos?: Iterable<number>;
};

/** 将向量检索原始行过滤为语义记忆章节列表（可单测，不依赖 Qdrant） */
export function pickMemoryChapterSummariesFromSearchRows(
  rows: unknown[],
  opts: MemoryChapterSummaryRetrieveOpts
): ChapterSummaryInput[] {
  const maxCount = Number.isFinite(opts.maxCount) ? Math.trunc(opts.maxCount) : 0;
  if (maxCount <= 0) {
    return [];
  }

  const current = opts.currentChapterNo ?? Number.MAX_SAFE_INTEGER;
  const exclude = new Set<number>();
  if (opts.excludeChapterNos) {
    for (const n of opts.excludeChapterNos) {
      if (Number.isFinite(n) && n > 0) {
        exclude.add(Math.trunc(n));
      }
    }
  }

  const out: ChapterSummaryInput[] = [];
  const seen = new Set<number>();

  for (const raw of rows) {
    const p = raw as { payload?: Record<string, unknown> };
    const payload = p.payload ?? {};
    const chapterNo = Number(payload.chapter_no);
    if (!Number.isFinite(chapterNo) || chapterNo <= 0 || chapterNo >= current) {
      continue;
    }
    if (exclude.has(chapterNo) || seen.has(chapterNo)) {
      continue;
    }
    seen.add(chapterNo);
    out.push({
      chapterNo,
      title: String(payload.docTitle ?? `第${chapterNo}章`),
      summary: String(payload.content ?? '').trim(),
    });
    if (out.length >= maxCount) {
      break;
    }
  }

  return out;
}

export async function retrieveMemoryChapterSummaries(
  projectId: string,
  query: string,
  opts: MemoryChapterSummaryRetrieveOpts
): Promise<ChapterSummaryInput[]> {
  const maxCount = Number.isFinite(opts.maxCount) ? Math.trunc(opts.maxCount) : 0;
  const embedText = query.trim().slice(0, MEMORY_CHAPTER_SUMMARY_EMBED_MAX_CHARS);
  if (maxCount <= 0 || !embedText) {
    return [];
  }

  const excludeSize = opts.excludeChapterNos
    ? [...opts.excludeChapterNos].filter((n) => Number.isFinite(n) && n > 0).length
    : 0;

  const env = getResolvedRagInfrastructureEnv();
  const client = createQdrantClientFromEnv(env);
  const collection = projectChunksCollectionName(projectId);

  try {
    const provider = getEmbeddingProvider();
    const { embeddings } = await provider.embed([embedText]);
    const vector = embeddings[0];
    if (!vector?.length) {
      return [];
    }

    await ensureProjectChunkCollection(client, collection, vector.length);

    const res = await client.search(collection, {
      vector,
      limit: maxCount + excludeSize + 5,
      with_payload: true,
      filter: {
        must: [{ key: 'doc_type', match: { value: CHAPTER_SUMMARY_DOC_TYPE } }],
      },
    });

    const rows = Array.isArray(res)
      ? res
      : res && typeof res === 'object' && 'points' in res
        ? ((res as { points?: unknown }).points as unknown[])
        : [];

    return pickMemoryChapterSummariesFromSearchRows(rows, opts);
  } catch (error) {
    console.error(`Memory chapter summary retrieve failed for ${projectId}:`, error);
    return [];
  }
}
