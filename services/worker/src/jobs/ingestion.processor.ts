import axios from 'axios';
import { getResolvedRagInfrastructureEnv } from '@aether-quill/config';
import { getEmbeddingProvider } from '@aether-quill/model-providers';
import { inferDocType, sectionsForIngestion } from './doc-section-parser';
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
    const docType = inferDocType(documentTitle, content);
    const sections = sectionsForIngestion(documentTitle, content, docType);

    const draftChunks: Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    onProgress?.(0);

    let segIndex = 0;
    const plannedSegments: Array<{
      text: string;
      section: string;
      sectionTitle: string;
    }> = [];

    for (const section of sections) {
      const segmentTexts = segmentForIngestion(section.content, {
        maxTokensPerChunk: env.ingestChunkTokenSize,
        tokenOverlap: env.ingestChunkTokenOverlap,
        mode: env.ingestSegmenter,
      });
      for (const text of segmentTexts) {
        plannedSegments.push({
          text,
          section: section.section,
          sectionTitle: section.sectionTitle,
        });
      }
    }

    const totalSeg = Math.max(plannedSegments.length, 1);
    plannedSegments.forEach((seg, index) => {
      const progress = Math.min(Math.round(((index + 1) / totalSeg) * 90), 90);
      onProgress?.(progress);

      draftChunks.push({
        id: `${documentId}-seg-${segIndex}`,
        content: seg.text,
        metadata: {
          index: segIndex,
          total: totalSeg,
          docTitle: documentTitle,
          documentId,
          doc_type: docType,
          document_type: docType,
          section: seg.section,
          section_title: seg.sectionTitle,
          ingestSegmenter: env.ingestSegmenter,
          tokenCount: countChunkTokens(seg.text),
        },
      });
      segIndex += 1;
    });

    if (draftChunks.length === 0) {
      const fallback = doc.content || '';
      draftChunks.push({
        id: `${documentId}-seg-0`,
        content: fallback,
        metadata: {
          index: 0,
          total: 1,
          docTitle: documentTitle,
          documentId,
          doc_type: docType,
          document_type: docType,
          section: 'general',
          section_title: '正文',
          ingestSegmenter: env.ingestSegmenter,
          tokenCount: countChunkTokens(fallback),
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
