import axios, { AxiosInstance } from 'axios';
import {
  ModelProvider,
  ProviderType,
  GenerationRequest,
  GenerationResponse,
  NormalizedSseEvent,
  ProviderConfig,
} from './types';

/**
 * DeepSeek 供应商配置
 */
export interface DeepSeekConfig extends ProviderConfig {
  baseUrl?: string;
}

/**
 * DeepSeek API 响应类型
 */
interface DeepSeekChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * DeepSeek 流式响应块
 */
interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * DeepSeek 供应商适配器
 */
export class DeepSeekProvider implements ModelProvider {
  private client: AxiosInstance;
  private defaultModel: string;

  constructor(config: DeepSeekConfig) {
    this.defaultModel = config.defaultModel || 'deepseek-chat';
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  getType(): ProviderType {
    return 'deepseek';
  }

  getName(): string {
    return 'DeepSeek';
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model || this.defaultModel;

    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    messages.push({ role: 'user', content: request.userPrompt });

    const response = await this.client.post<DeepSeekChatCompletionResponse>('/chat/completions', {
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature || 0.7,
      top_p: request.topP || 0.95,
      stream: false,
    });

    const choice = response.data.choices[0];

    return {
      content: choice.message.content,
      usage: response.data.usage
        ? {
            promptTokens: response.data.usage.prompt_tokens,
            completionTokens: response.data.usage.completion_tokens,
            totalTokens: response.data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *streamGenerate(request: GenerationRequest): AsyncIterable<NormalizedSseEvent> {
    const model = request.model || this.defaultModel;

    const messages: Array<{ role: string; content: string }> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    messages.push({ role: 'user', content: request.userPrompt });

    yield {
      type: 'start',
      data: JSON.stringify({ model }),
    };

    try {
      const response = await this.client.post(
        '/chat/completions',
        {
          model,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature || 0.7,
          top_p: request.topP || 0.95,
          stream: true,
        },
        {
          responseType: 'stream',
          headers: {
            Accept: 'text/event-stream',
          },
        }
      );

      const stream = response.data as NodeJS.ReadableStream;

      for await (const chunk of stream) {
        const chunkStr = chunk.toString('utf-8');
        const lines = chunkStr.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              yield {
                type: 'complete',
                data: '',
              };
              return;
            }

            try {
              const data: DeepSeekStreamChunk = JSON.parse(dataStr);
              const choice = data.choices[0];

              if (choice.delta.content) {
                yield {
                  type: 'content',
                  data: choice.delta.content,
                  id: data.id,
                };
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        data: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * DeepSeek 供应商工厂
 */
export class DeepSeekFactory {
  create(config: DeepSeekConfig): DeepSeekProvider {
    return new DeepSeekProvider(config);
  }

  getType(): ProviderType {
    return 'deepseek';
  }
}
