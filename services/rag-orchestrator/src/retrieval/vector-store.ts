import axios from 'axios';
import { ChunkWithEmbedding } from './types';

export class VectorStore {
  private readonly apiBaseUrl: string;
  private readonly chunksByProject = new Map<string, ChunkWithEmbedding[]>();

  constructor(apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl;
  }

  async ensureProjectChunks(projectId: string): Promise<ChunkWithEmbedding[]> {
    const cached = this.chunksByProject.get(projectId);
    if (cached) {
      return cached;
    }

    try {
      const docResponse = await axios.get(`${this.apiBaseUrl}/api/projects/${projectId}/documents`);
      const docs =
        docResponse.data?.data ?? (Array.isArray(docResponse.data) ? docResponse.data : []);

      const allChunks: ChunkWithEmbedding[] = [];

      for (const doc of docs) {
        const chunkResponse = await axios.get(`${this.apiBaseUrl}/api/documents/${doc.id}/chunks`);
        const chunks =
          chunkResponse.data?.data ?? (Array.isArray(chunkResponse.data) ? chunkResponse.data : []);

        for (const chunk of chunks) {
          const metadata = {
            ...(chunk.metadata || {}),
            docTitle: doc.title,
          };
          allChunks.push({
            id: chunk.id || `${doc.id}-chunk-${allChunks.length}`,
            documentId: doc.id,
            content: chunk.content || '',
            embedding:
              chunk.embedding ||
              this.extractEmbedding(metadata) ||
              this.simulateEmbedding(chunk.content || ''),
            metadata,
          });
        }
      }

      this.chunksByProject.set(projectId, allChunks);
      return allChunks;
    } catch (error) {
      console.error(`Failed to load chunks for project ${projectId}:`, error);
      return [];
    }
  }

  async retrieve(request: {
    query: string;
    projectId: string;
    topK?: number;
    minScore?: number;
  }): Promise<ChunkWithEmbedding[]> {
    const chunks = await this.ensureProjectChunks(request.projectId);
    const topK = request.topK || 30;
    const minScore = request.minScore || 0;

    if (chunks.length === 0) {
      return [];
    }

    const queryEmbedding = this.simulateEmbedding(request.query);
    const scored = cosineSimilarityAll(queryEmbedding, chunks);

    const filtered = scored.filter((c) => (c.score || 0) >= minScore);
    filtered.sort((a, b) => (b.score || 0) - (a.score || 0));

    return filtered.slice(0, topK);
  }

  invalidateProject(projectId: string): void {
    this.chunksByProject.delete(projectId);
  }

  private extractEmbedding(metadata: Record<string, unknown>): number[] | undefined {
    const raw = metadata.embedding;
    if (!Array.isArray(raw) || raw.length === 0) {
      return undefined;
    }
    if (!raw.every((item) => typeof item === 'number')) {
      return undefined;
    }
    return raw;
  }

  private simulateEmbedding(text: string): number[] {
    const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const embedding: number[] = [];
    for (let i = 0; i < 128; i++) {
      embedding.push(Math.sin(seed * (i + 1)) * 0.5 + 0.5);
    }
    return embedding;
  }
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function magnitude(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (magA * magB);
}

function cosineSimilarityAll(query: number[], chunks: ChunkWithEmbedding[]): ChunkWithEmbedding[] {
  return chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(query, chunk.embedding),
  }));
}
