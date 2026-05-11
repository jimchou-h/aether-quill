import axios from 'axios';
import { TraceRecord, GenerateRequest } from './types';

export interface GenerationContext {
  systemPromptText: string;
  personaProfile: string;
  outlineSummary: string;
  chapterContext: string;
}

export class GenerationService {
  private readonly traces: TraceRecord[] = [];

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

    this.traces.push(trace);
    return trace;
  }

  updateTrace(traceId: string, updates: Partial<TraceRecord>): void {
    const trace = this.traces.find((t) => t.id === traceId);
    if (trace) {
      Object.assign(trace, updates);
    }
  }

  getTrace(traceId: string): TraceRecord | undefined {
    return this.traces.find((t) => t.id === traceId);
  }

  listTraces(projectId: string, limit = 20, offset = 0): TraceRecord[] {
    const projectTraces = this.traces
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return projectTraces.slice(offset, offset + limit);
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

  private async callProviderApi(prompt: string): Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const providerUrl =
      process.env.PROVIDER_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const apiKey = process.env.PROVIDER_API_KEY || process.env.DEEPSEEK_API_KEY || '';

    const response = await axios.post(
      providerUrl,
      {
        model: process.env.PROVIDER_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Number(process.env.PROVIDER_MAX_TOKENS || 4096),
        temperature: Number(process.env.PROVIDER_TEMPERATURE || 0.7),
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
    const providerUrl =
      process.env.PROVIDER_API_URL || 'https://api.deepseek.com/v1/chat/completions';
    const apiKey = process.env.PROVIDER_API_KEY || process.env.DEEPSEEK_API_KEY || '';
    const useMock = !apiKey || process.env.USE_MOCK_PROVIDER === 'true';

    if (useMock) {
      const mockChunks = this.getMockChunks(prompt);
      for (const chunk of mockChunks) {
        yield chunk;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return;
    }

    const response = await axios.post(
      providerUrl,
      {
        model: process.env.PROVIDER_MODEL || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Number(process.env.PROVIDER_MAX_TOKENS || 4096),
        temperature: Number(process.env.PROVIDER_TEMPERATURE || 0.7),
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

  private getMockChunks(_prompt: string): string[] {
    void _prompt;
    const sentences = [
      '海风掠过港口的铁链，发出沉闷的碰撞声。\n\n',
      '林默站在码头的边缘，目光凝视着远方模糊的海平线。\n\n',
      '他的手中紧握着一封泛黄的信件，纸张的边缘已经被反复折叠得快要破损。\n\n',
      '"你确定要这么做吗？"身后传来一个低沉的声音。\n\n',
      '林默没有回头，只是轻轻地点了点头。他知道，一旦踏上这条道路，就再也没有回头的余地。\n\n',
      '远处的海面上，一艘船的轮廓逐渐清晰起来。那是他等待已久的信号。\n\n',
      '风更大了，吹得他的衣角猎猎作响。但他站在那里，纹丝不动，如同礁石一般。\n\n',
      '这一刻，所有的犹豫和迟疑都被抛在了身后。新的篇章，就此展开。\n\n',
      '（本段为模拟生成内容，接入真实模型后将替换为 AI 生成文本。）',
    ];
    return sentences;
  }
}
