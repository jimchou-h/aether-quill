export interface ChunkWithEmbedding {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  score?: number;
}

export interface RetrieveRequest {
  query: string;
  projectId: string;
  topK?: number;
  minScore?: number;
}

export interface RetrieveResponse {
  chunks: ChunkWithEmbedding[];
  query: string;
  projectId: string;
  topK: number;
  totalRetrieved: number;
}

export interface RerankRequest {
  query: string;
  chunks: ChunkWithEmbedding[];
  topN?: number;
}

export interface RerankResponse {
  rerankedChunks: ChunkWithEmbedding[];
  query: string;
  topN: number;
}
