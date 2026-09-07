import type { UserDocType } from './documents-type.util';
import { DEFAULT_USER_DOC_TYPE } from './documents-type.util';

export type IndexStatus = 'pending' | 'indexing' | 'completed' | 'failed' | 'stale';

export interface DocumentRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  docType: UserDocType;
  /** 关联人物（persona_card）；其它类型一般为 null */
  personaId?: string | null;
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

export interface IndexedChunkInput {
  id: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface CommitIndexResultInput {
  status: 'completed' | 'failed';
  chunks?: IndexedChunkInput[];
  errorMessage?: string;
}
