export type IngestionTargetType = 'document' | 'project';

export interface IngestionJobData {
  type: 'ingestion';
  targetType: IngestionTargetType;
  targetId: string;
  projectId: string;
  mode: 'full' | 'incremental';
}

export interface JobRecord {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  data: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
