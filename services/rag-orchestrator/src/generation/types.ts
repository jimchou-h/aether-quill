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
  /** 本次生成使用的采样温度（已解析后的最终值） */
  temperature?: number;
  /** 本次生成 completion max_tokens（请求显式传入时优先于供应商默认） */
  maxTokens?: number;
  /**
   * 供应商返回的结束原因（stop / length / content_filter …）。
   * 流被提前切断时为 null，调用方据此判定「非空内容不等于成功」。
   */
  finishReason?: string | null;
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
