export type TraceStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface TraceRecord {
  id: string;
  projectId: string;
  prompt: string;
  context: Record<string, unknown>;
  result?: string;
  providerType: string;
  model: string;
  status: TraceStatus;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface GenerateRequest {
  prompt: string;
  projectId: string;
  systemPrompt?: string;
  context?: Record<string, unknown>;
  useSSE?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SseEvent {
  event: 'start' | 'content' | 'end' | 'error';
  data: string;
  traceId?: string;
}
