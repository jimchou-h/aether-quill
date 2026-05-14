import { Reranker } from './reranker';
import { ChunkWithEmbedding } from './types';
import { VectorStore } from './vector-store';

export interface DraftCitation {
  sourceType: string;
  sourceId: string;
  snippet: string;
}

export interface KnowledgeRetrievalResult {
  chunks: ChunkWithEmbedding[];
  citations: DraftCitation[];
  evidenceText: string;
  query: string;
}

/** 供 /api/generate 检索：用户 prompt +（可选）任务字段 + 项目侧摘要，单次拼接即 V1「query rewrite」 */
export function buildGenerationRetrievalQuery(
  userPrompt: string,
  projectCtx: { outlineSummary: string; personaProfile: string },
  extraContext?: Record<string, unknown>
): string {
  const parts: string[] = [];
  const trimmed = userPrompt.trim();
  if (trimmed) {
    parts.push(trimmed);
  }

  const task = extraContext?.task;
  const isTaskObject = typeof task === 'object' && task !== null && !Array.isArray(task);

  if (isTaskObject) {
    const tail = buildRetrievalQuery(task as Record<string, unknown>, projectCtx);
    if (tail.trim()) {
      parts.push(tail.trim());
    }
  } else {
    if (projectCtx.outlineSummary.trim()) {
      parts.push(projectCtx.outlineSummary.trim().slice(0, 800));
    }
    if (projectCtx.personaProfile.trim() && projectCtx.personaProfile !== '未配置人物设定') {
      parts.push(projectCtx.personaProfile.trim().slice(0, 500));
    }
  }

  return parts.join('\n\n');
}

export function buildRetrievalQuery(
  task: Record<string, unknown>,
  context: { outlineSummary: string; personaProfile: string }
): string {
  const parts: string[] = [];
  const goal = typeof task.goal === 'string' ? task.goal.replace(/\\n/g, '\n') : '';
  if (goal.trim()) {
    parts.push(goal.trim());
  }

  if (Array.isArray(task.mustInclude)) {
    const includes = task.mustInclude.map(String).filter(Boolean);
    if (includes.length > 0) {
      parts.push(includes.join(' '));
    }
  }

  if (Array.isArray(task.avoid)) {
    const avoid = task.avoid.map(String).filter(Boolean);
    if (avoid.length > 0) {
      parts.push(`避免: ${avoid.join(' ')}`);
    }
  }

  if (typeof task.pov === 'string' && task.pov.trim()) {
    parts.push(task.pov.trim());
  }

  if (context.outlineSummary.trim()) {
    parts.push(context.outlineSummary.trim());
  }

  if (context.personaProfile.trim() && context.personaProfile !== '未配置人物设定') {
    parts.push(context.personaProfile.trim());
  }

  return parts.join('\n');
}

export function formatEvidence(chunks: ChunkWithEmbedding[]): string {
  if (chunks.length === 0) {
    return '';
  }

  return chunks
    .map((chunk, index) => {
      const title =
        typeof chunk.metadata?.docTitle === 'string' ? chunk.metadata.docTitle : '未命名文档';
      const cid = chunk.id?.trim() || `chunk-${index + 1}`;
      return `[证据${index + 1}] chunk_id=${cid} doc=${title}\n${chunk.content.trim()}`;
    })
    .join('\n\n');
}

export function chunksToCitations(chunks: ChunkWithEmbedding[]): DraftCitation[] {
  return chunks.map((chunk) => ({
    sourceType: 'document',
    sourceId: chunk.documentId,
    snippet: chunk.content.trim().slice(0, 200),
  }));
}

export async function retrieveKnowledgeForDraft(
  vectorStore: VectorStore,
  reranker: Reranker,
  projectId: string,
  query: string,
  options?: { topK?: number; topN?: number; minScore?: number }
): Promise<KnowledgeRetrievalResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { chunks: [], citations: [], evidenceText: '', query: trimmed };
  }

  const topK = options?.topK ?? 30;
  const topN = options?.topN ?? 10;
  vectorStore.invalidateProject(projectId);

  const retrieved = await vectorStore.retrieve({
    query: trimmed,
    projectId,
    topK,
    minScore: options?.minScore ?? 0,
  });
  const reranked = reranker.rerank(trimmed, retrieved, topN);

  return {
    chunks: reranked,
    citations: chunksToCitations(reranked),
    evidenceText: formatEvidence(reranked),
    query: trimmed,
  };
}
