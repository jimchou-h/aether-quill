import axios from 'axios';

export interface ChunkResult {
  documentId: string;
  chunks: Array<{
    id: string;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }>;
}

export interface IngestionProcessorOptions {
  apiBaseUrl: string;
}

export class IngestionProcessor {
  private readonly apiBaseUrl: string;

  constructor(options: IngestionProcessorOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
  }

  async processDocument(
    documentId: string,
    onProgress?: (progress: number) => void
  ): Promise<ChunkResult> {
    const docResponse = await axios.get(`${this.apiBaseUrl}/api/documents/${documentId}`);
    const doc = docResponse.data?.data ?? docResponse.data;

    const content: string = doc.content || '';
    const chunkSize = 500;
    const chunks: ChunkResult['chunks'] = [];

    onProgress?.(0);

    for (let i = 0; i < content.length; i += chunkSize) {
      const chunkContent = content.slice(i, i + chunkSize);
      if (chunkContent.trim().length === 0) continue;

      const progress = Math.min(Math.round((i / content.length) * 100), 99);
      onProgress?.(progress);

      chunks.push({
        id: `${documentId}-chunk-${Math.floor(i / chunkSize)}`,
        content: chunkContent,
        embedding: this.simulateEmbedding(chunkContent),
        metadata: {
          index: Math.floor(i / chunkSize),
          total: Math.ceil(content.length / chunkSize),
          docTitle: doc.title,
          documentId,
        },
      });
    }

    if (chunks.length === 0) {
      chunks.push({
        id: `${documentId}-chunk-0`,
        content: doc.content || '',
        embedding: this.simulateEmbedding(doc.content || ''),
        metadata: {
          index: 0,
          total: 1,
          docTitle: doc.title,
          documentId,
        },
      });
    }

    onProgress?.(100);

    return { documentId, chunks };
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
