import axios from 'axios';
import { TraceRecord, GenerateRequest } from './types';
import { TraceStore, TraceQuery, TraceStats } from './trace-store';

export interface GenerationContext {
  systemPromptText: string;
  personaProfile: string;
  outlineSummary: string;
  chapterContext: string;
  retrievedEvidence?: string;
}

interface ProviderRuntimeConfig {
  providerUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export class GenerationService {
  private readonly traceStore = new TraceStore();

  buildPrompt(context: GenerationContext, userPrompt: string): string {
    const sections: string[] = [];

    if (context.systemPromptText) {
      sections.push(`【系统指令】\n${context.systemPromptText}`);
    }
    if (context.personaProfile && context.personaProfile !== '未配置人物设定') {
      sections.push(`【人物设定】\n${context.personaProfile}`);
    }
    if (context.outlineSummary) {
      sections.push(`【大纲总结】\n${context.outlineSummary}`);
    }
    if (context.chapterContext) {
      sections.push(`【上下文】\n${context.chapterContext}`);
    }
    if (context.retrievedEvidence) {
      sections.push(`【检索证据】\n${context.retrievedEvidence}`);
    }

    sections.push(`【用户需求】\n${userPrompt}`);

    return sections.join('\n\n');
  }

  async createTrace(request: GenerateRequest): Promise<TraceRecord> {
    const trace: TraceRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: request.projectId,
      prompt: request.prompt,
      context: request.context || {},
      providerType: request.provider || 'deepseek',
      model: request.model || 'deepseek-chat',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.traceStore.push(trace);
    return trace;
  }

  updateTrace(traceId: string, updates: Partial<TraceRecord>): void {
    this.traceStore.update(traceId, updates);
  }

  getTrace(traceId: string): TraceRecord | undefined {
    return this.traceStore.findById(traceId);
  }

  queryTraces(query: TraceQuery): { data: TraceRecord[]; total: number } {
    return this.traceStore.query(query);
  }

  getStats(projectId?: string): TraceStats {
    return this.traceStore.getStats(projectId);
  }

  getTraceCount(): number {
    return this.traceStore.getStats().total;
  }

  async generateNonStream(trace: TraceRecord, context: GenerationContext): Promise<string> {
    const prompt = this.buildPrompt(context, trace.prompt);
    this.updateTrace(trace.id, { status: 'generating' });

    try {
      const response = await this.callProviderApi(prompt);
      this.updateTrace(trace.id, {
        status: 'completed',
        result: response.content,
        completedAt: new Date().toISOString(),
        usage: response.usage,
      });
      return response.content;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      this.updateTrace(trace.id, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async *generateStream(
    trace: TraceRecord,
    context: GenerationContext
  ): AsyncGenerator<string, void, unknown> {
    const prompt = this.buildPrompt(context, trace.prompt);
    this.updateTrace(trace.id, { status: 'generating' });
    let fullContent = '';

    try {
      for await (const chunk of this.callProviderStream(prompt)) {
        fullContent += chunk;
        yield chunk;
      }

      this.updateTrace(trace.id, {
        status: 'completed',
        result: fullContent,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      this.updateTrace(trace.id, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private resolveProviderConfig(): ProviderRuntimeConfig {
    const apiKey =
      process.env.PROVIDER_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.SILICONFLOW_API_KEY ||
      '';
    if (!apiKey) {
      throw new Error(
        '未配置模型 API Key，请设置 PROVIDER_API_KEY、DEEPSEEK_API_KEY 或 SILICONFLOW_API_KEY'
      );
    }

    const preferSiliconFlow =
      Boolean(process.env.SILICONFLOW_API_KEY) &&
      !process.env.DEEPSEEK_API_KEY &&
      !process.env.PROVIDER_API_KEY;
    const defaultUrl = preferSiliconFlow
      ? 'https://api.siliconflow.cn/v1/chat/completions'
      : 'https://api.deepseek.com/v1/chat/completions';
    const defaultModel = preferSiliconFlow ? 'Qwen/Qwen2.5-7B-Instruct' : 'deepseek-chat';

    return {
      providerUrl: process.env.PROVIDER_API_URL || defaultUrl,
      apiKey,
      model: process.env.PROVIDER_MODEL || defaultModel,
      maxTokens: Number(process.env.PROVIDER_MAX_TOKENS || 4096),
      temperature: Number(process.env.PROVIDER_TEMPERATURE || 0.7),
    };
  }

  buildChapterSummaryPrompt(input: { chapterNo: number; title: string; content: string }): string {
    return [
      '你是一位小说编辑，请为以下章节正文生成一段中文语义摘要。',
      '要求：',
      '1. 概括主要情节、冲突与结果，不要逐句复述',
      '2. 控制在 80~160 字',
      '3. 只输出摘要正文，不要标题、编号或解释',
      '',
      `章节：第${input.chapterNo}章 ${input.title}`,
      '正文：',
      input.content,
    ].join('\n');
  }

  async summarizeChapterContent(input: {
    chapterNo: number;
    title: string;
    content: string;
  }): Promise<string> {
    const prompt = this.buildChapterSummaryPrompt(input);
    const result = await this.callProviderApi(prompt, {
      maxTokens: 512,
      temperature: 0.3,
    });
    return result.content.trim();
  }

  private async callProviderApi(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const provider = this.resolveProviderConfig();

    const response = await axios.post(
      provider.providerUrl,
      {
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options?.maxTokens ?? provider.maxTokens,
        temperature: options?.temperature ?? provider.temperature,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const choice = response.data?.choices?.[0];
    return {
      content: choice?.message?.content || '',
      usage: response.data?.usage
        ? {
            promptTokens: response.data.usage.prompt_tokens || 0,
            completionTokens: response.data.usage.completion_tokens || 0,
            totalTokens: response.data.usage.total_tokens || 0,
          }
        : undefined,
    };
  }

  private async *callProviderStream(prompt: string): AsyncGenerator<string, void, unknown> {
    const provider = this.resolveProviderConfig();

    const response = await axios.post(
      provider.providerUrl,
      {
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: provider.maxTokens,
        temperature: provider.temperature,
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        timeout: 120000,
      }
    );

    const stream = response.data as NodeJS.ReadableStream;

    for await (const chunk of stream) {
      const chunkStr = chunk.toString('utf-8');
      const lines = chunkStr.split('\n').filter((line: string) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            yield content;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }
}
