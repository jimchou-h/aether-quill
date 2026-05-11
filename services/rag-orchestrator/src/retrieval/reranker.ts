import { ChunkWithEmbedding } from './types';

export interface RerankerOptions {
  relevanceWeight?: number;
  diversityWeight?: number;
  maxLength?: number;
}

export class Reranker {
  private readonly relevanceWeight: number;
  private readonly diversityWeight: number;
  private readonly maxLength: number;

  constructor(options?: RerankerOptions) {
    this.relevanceWeight = options?.relevanceWeight ?? 0.8;
    this.diversityWeight = options?.diversityWeight ?? 0.2;
    this.maxLength = options?.maxLength ?? 512;
  }

  rerank(query: string, chunks: ChunkWithEmbedding[], topN?: number): ChunkWithEmbedding[] {
    const n = topN ?? chunks.length;

    if (chunks.length === 0) {
      return [];
    }

    const scored = chunks.map((chunk) => {
      const relevanceScore = this.computeRelevance(query, chunk);
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

  private computeRelevance(query: string, chunk: ChunkWithEmbedding): number {
    const queryLower = query.toLowerCase();
    const contentLower = chunk.content.toLowerCase();
    const metadataText = JSON.stringify(chunk.metadata || {}).toLowerCase();

    const queryTokens = this.tokenize(queryLower);

    const matchedTokens = queryTokens.filter((token) => contentLower.includes(token));

    const contentScore = queryTokens.length > 0 ? matchedTokens.length / queryTokens.length : 0;

    const titleBonus = this.getTitleBonus(queryTokens, metadataText);

    const positionWeight = this.getPositionWeight(chunk);

    const exactPhraseBonus = this.getExactPhraseBonus(queryLower, contentLower);

    const rawScore =
      contentScore * 0.5 + titleBonus * 0.25 + positionWeight * 0.15 + exactPhraseBonus * 0.1;

    return Math.min(rawScore, 1.0);
  }

  private tokenize(text: string): string[] {
    return text.split(/[\s,，。.！!？?；;：:、()（）【】]+/).filter((t) => t.length > 0);
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
    const seenDocs = new Set<string>();

    for (const chunk of scored) {
      if (result.length >= topN) {
        break;
      }

      const docId = chunk.documentId;
      if (!seenDocs.has(docId)) {
        seenDocs.add(docId);
        result.push(chunk);
      } else if (this.diversityWeight < 0.5) {
        result.push(chunk);
      }
    }

    return result;
  }
}
