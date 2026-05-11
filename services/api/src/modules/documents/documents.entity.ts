export type IndexStatus = 'pending' | 'indexing' | 'completed' | 'failed';

export interface DocumentRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  indexStatus: IndexStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DocumentVersion {
  version: number;
  title: string;
  content: string;
  createdAt: Date;
}

export interface ReindexResult {
  documentId: string;
  indexStatus: IndexStatus;
}
