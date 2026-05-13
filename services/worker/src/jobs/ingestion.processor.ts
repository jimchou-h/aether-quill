import axios from 'axios';
import { getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import { getEmbeddingProvider } from '@aether-quill/model-providers';
import { countChunkTokens, segmentForIngestion } from './segmenter';

export interface ChunkResult {
  documentId: string;
  projectId: string;
  documentVersion: number;
  documentTitle: string;
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

const EMBED_BATCH = 16;

async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = getEmbeddingProvider();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const { embeddings } = await provider.embed(batch);
    out.push(...embeddings);
  }
  if (out.length !== texts.length) {
    throw new Error(`embedding batch size mismatch: expected ${texts.length}, got ${out.length}`);
  }
  return out;
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

    const projectId: string = doc.projectId || '';
    const documentVersion: number = Number(doc.version) || 1;
    const documentTitle: string = doc.title || '';

    const content: string = doc.content || '';
    const env = getResolvedRagInfrastructureEnv();

    const segmentTexts = segmentForIngestion(content, {
      maxTokensPerChunk: env.ingestChunkTokenSize,
      tokenOverlap: env.ingestChunkTokenOverlap,
      mode: env.ingestSegmenter,
    });

    const draftChunks: Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    onProgress?.(0);

    const totalSeg = Math.max(segmentTexts.length, 1);
    segmentTexts.forEach((text, index) => {
      const progress = Math.min(Math.round(((index + 1) / totalSeg) * 90), 90);
      onProgress?.(progress);

      draftChunks.push({
        id: `${documentId}-seg-${index}`,
        content: text,
        metadata: {
          index,
          total: totalSeg,
          docTitle: doc.title,
          documentId,
          ingestSegmenter: env.ingestSegmenter,
          tokenCount: countChunkTokens(text),
        },
      });
    });

    if (draftChunks.length === 0) {
      draftChunks.push({
        id: `${documentId}-seg-0`,
        content: doc.content || '',
        metadata: {
          index: 0,
          total: 1,
          docTitle: doc.title,
          documentId,
          ingestSegmenter: env.ingestSegmenter,
          tokenCount: countChunkTokens(doc.content || ''),
        },
      });
    }

    onProgress?.(95);
    const embeddings = await embedTexts(draftChunks.map((c) => c.content));
    const chunks: ChunkResult['chunks'] = draftChunks.map((c, idx) => ({
      id: c.id,
      content: c.content,
      embedding: embeddings[idx],
      metadata: c.metadata,
    }));

    onProgress?.(100);

    return {
      documentId,
      projectId,
      documentVersion,
      documentTitle,
      chunks,
    };
  }
}
