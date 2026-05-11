/**
 * 模型供应商适配器类型定义
 */

/**
 * 支持的供应商类型
 */
export type ProviderType = 'deepseek' | 'siliconflow';

/**
 * 生成请求参数
 */
export interface GenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

/**
 * 生成响应（流式）
 */
export interface GenerationStreamResponse {
  content: string;
  isComplete: boolean;
  error?: string;
}

/**
 * 生成响应（非流式）
 */
export interface GenerationResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * SSE 事件类型
 */
export type SseEventType = 'start' | 'content' | 'error' | 'complete';

/**
 * 归一化的 SSE 事件
 */
export interface NormalizedSseEvent {
  type: SseEventType;
  data: string;
  id?: string;
}

/**
 * 供应商配置
 */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * 供应商适配器接口
 */
export interface ModelProvider {
  /**
   * 获取供应商类型
   */
  getType(): ProviderType;

  /**
   * 获取供应商名称
   */
  getName(): string;

  /**
   * 流式生成
   * @param request 生成请求
   * @returns 异步迭代器，返回归一化的 SSE 事件
   */
  streamGenerate(request: GenerationRequest): AsyncIterable<NormalizedSseEvent>;

  /**
   * 非流式生成
   * @param request 生成请求
   * @returns 生成响应
   */
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

/**
 * 供应商工厂接口
 */
export interface ProviderFactory {
  create(config: ProviderConfig): ModelProvider;
  getType(): ProviderType;
}