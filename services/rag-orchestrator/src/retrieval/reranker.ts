/**
 * 检索结果重排
 *
 * 默认：向量分（Qdrant score）与词汇相关分加权融合，再按 documentId 做多样性截断（每文档最多 N chunk）。
 * 可选：环境变量启用 cross-encoder 时，用 cross-encoder 分替代词汇分参与融合。
 *
 * 词汇分考量：query token 命中率、标题/metadata 加分、chunk 位置、短语精确匹配。
 */

import type { CrossEncoderScorer } from './cross-encoder-scorer';
import { isCrossEncoderRerankEnabled } from './cross-encoder-scorer';
import {
  DEFAULT_RERANK_LEXICAL_WEIGHT,
  DEFAULT_RERANK_VECTOR_WEIGHT,
  resolveRerankMaxPerDocFromEnv,
  resolveRerankWeightsFromEnv,
} from './reranker-env';
import { tokenizeForRerank } from './reranker-tokenize';
import { ChunkWithEmbedding } from './types';

export interface RerankerOptions {
  vectorWeight?: number;
  lexicalWeight?: number;
  /** 同一 documentId 在 topN 中最多保留的 chunk 数（默认 1） */
  maxPerDocument?: number;
  /** 注入后且 `RERANK_PROVIDER` 启用 cross-encoder 时使用；默认 undefined */
  crossEncoderScorer?: CrossEncoderScorer;
}

export function normalizeVectorScore(score: number | undefined): number {
  if (score === undefined || !Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}

export function computeFusedRerankScore(
  vectorScore: number | undefined,
  lexicalScore: number,
  vectorWeight: number,
  lexicalWeight: number
): number {
  const v = normalizeVectorScore(vectorScore);
  const lexical = Math.min(1, Math.max(0, lexicalScore));
  const total = vectorWeight + lexicalWeight;
  const vw = total > 0 ? vectorWeight / total : DEFAULT_RERANK_VECTOR_WEIGHT;
  const lw = total > 0 ? lexicalWeight / total : DEFAULT_RERANK_LEXICAL_WEIGHT;
  return Math.min(1, vw * v + lw * lexical);
}

export class Reranker {
  private readonly vectorWeight: number;
  private readonly lexicalWeight: number;
  private readonly maxPerDocument: number;
  private readonly crossEncoderScorer?: CrossEncoderScorer;

  constructor(options?: RerankerOptions) {
    const envWeights = resolveRerankWeightsFromEnv();
    this.vectorWeight = options?.vectorWeight ?? envWeights.vectorWeight;
    this.lexicalWeight = options?.lexicalWeight ?? envWeights.lexicalWeight;
    this.maxPerDocument = options?.maxPerDocument ?? resolveRerankMaxPerDocFromEnv();
    this.crossEncoderScorer = options?.crossEncoderScorer;
  }

  rerank(query: string, chunks: ChunkWithEmbedding[], topN?: number): ChunkWithEmbedding[] {
    const n = topN ?? chunks.length;

    if (chunks.length === 0) {
      return [];
    }

    const useCrossEncoder = isCrossEncoderRerankEnabled() && this.crossEncoderScorer !== undefined;
    const crossEncoderScores = useCrossEncoder
      ? this.crossEncoderScorer!.score(query, chunks)
      : undefined;

    const scored = chunks.map((chunk, index) => {
      const lexicalScore = this.computeLexicalRelevance(query, chunk);
      const relevanceScore =
        crossEncoderScores !== undefined
          ? computeFusedRerankScore(
              chunk.score,
              normalizeVectorScore(crossEncoderScores[index]),
              this.vectorWeight,
              this.lexicalWeight
            )
          : computeFusedRerankScore(
              chunk.score,
              lexicalScore,
              this.vectorWeight,
              this.lexicalWeight
            );

      return {
        ...chunk,
        score: relevanceScore,
      };
    });

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

    const selected = this.applyDiversity(scored, n);

    return selected.map((chunk, index) => ({
      ...chunk,
      score: chunk.score ? Math.round(chunk.score * 10000) / 10000 - index * 0.0001 : 0,
    }));
  }

  private computeLexicalRelevance(query: string, chunk: ChunkWithEmbedding): number {
    const queryLower = query.toLowerCase();
    const contentLower = chunk.content.toLowerCase();
    const metadataText = JSON.stringify(chunk.metadata || {}).toLowerCase();

    const queryTokens = tokenizeForRerank(queryLower);

    const matchedTokens = queryTokens.filter((token) => contentLower.includes(token));

    const contentScore = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0;

    const titleBonus = this.getTitleBonus(queryTokens, metadataText);

    const positionWeight = this.getPositionWeight(chunk);

    const exactPhraseBonus = this.getExactPhraseBonus(queryLower, contentLower);

    const rawScore =
      contentScore * 0.5 + titleBonus * 0.25 + positionWeight * 0.15 + exactPhraseBonus * 0.1;

    return Math.min(rawScore, 1.0);
  }

  private getTitleBonus(queryTokens: string[], metadataText: string): number {
    const matched = queryTokens.filter((token) => metadataText.includes(token));
    return queryTokens.length > 0 ? matched.length / queryTokens.length : 0;
  }

  private getPositionWeight(chunk: ChunkWithEmbedding): number {
    const metadata = chunk.metadata as Record<string, unknown>;
    const index = typeof metadata.index === 'number' ? metadata.index : 0;
    const total = typeof metadata.total === 'number' ? metadata.total : 1;
    return total > 0 ? 0.5 * (1 - index / total) : 0;
  }

  private getExactPhraseBonus(queryLower: string, contentLower: string): number {
    const phrases = this.extractPhrases(queryLower);
    if (phrases.length === 0) {
      return 0;
    }

    const matched = phrases.filter((phrase) => contentLower.includes(phrase));
    return matched.length / phrases.length;
  }

  private extractPhrases(text: string): string[] {
    const parts = text.split(/[,，、]+/).filter((p) => p.trim().length > 0);
    return parts.length > 1 ? parts.map((p) => p.trim()) : [];
  }

  private applyDiversity(scored: ChunkWithEmbedding[], topN: number): ChunkWithEmbedding[] {
    if (scored.length <= topN) {
      return scored;
    }

    const result: ChunkWithEmbedding[] = [];
    const docCounts = new Map<string, number>();

    for (const chunk of scored) {
      if (result.length >= topN) {
        break;
      }

      const docId = chunk.documentId;
      const count = docCounts.get(docId) ?? 0;
      if (count < this.maxPerDocument) {
        docCounts.set(docId, count + 1);
        result.push(chunk);
      }
    }

    return result;
  }
}
