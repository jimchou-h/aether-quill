/**
 * 生成服务 — LLM 调用与 Prompt 拼装
 *
 * 默认消息结构（`buildLlmMessages`）：
 *   system ← 全局默认 + 项目 systemPromptText + 任务 taskSystemPrompt
 *   user   ←【参考上下文】→【检索证据】→【文风参照】（如有）→【任务输入】
 *
 * `LLM_PROMPT_LEGACY_SINGLE_USER=1` 时回退为单条 user（含【系统指令】段）。
 *
 * 叙事上下文由 `context/narrative-context` 在 main 层预先拼装；
 * 检索证据由 `retrieval/knowledge-retrieval` 在 main 层注入 `GenerationContext.retrievedEvidence`。
 *
 * 除主生成外，本类还承载章节摘要、人物状态、关系事件、结构化信息解析等「单次 LLM 调用」任务。
 */

import axios from 'axios';
import {
  buildChapterSummaryPromptRules,
  normalizeChapterSummary,
  resolveGenerationCallProfile,
  resolveLlmChatProviderEndpoint,
  type LlmChatProviderId,
} from '@aether-quill/config';
import {
  applyThinkingTokenReserve,
  formatEmptyChatContentError,
  shouldEnableChatThinking,
  shouldRetryChatWithoutThinking,
  withChatThinkingMode,
} from '@aether-quill/model-providers';
import { TraceRecord, GenerateRequest } from './types';
import { consumeProviderSseStreamChunk, flushProviderSseStreamBuffer } from './provider-sse-stream';
import { createUtf8StreamDecoder } from './utf8-stream-decoder';
import { TraceStore, TraceQuery, TraceStats } from './trace-store';
import {
  buildChapterIdentityRelationExtractPrompt,
  parseIdentityRelationsFromModelContent,
} from './identity-relation-extract';
import { buildSummaryLineFromSnapshot } from '../context/persona-snapshot';
import { logAssembledGenerationPrompt, logGenerationResponse } from './generation-prompt-log';
import {
  buildLlmMessages,
  buildLegacySingleUserPrompt,
  buildSystemMessage,
  buildUserMessage,
  type GenerationContext,
  type LlmChatMessage,
} from './generation-prompt-assembler';

export type { GenerationContext, LlmChatMessage } from './generation-prompt-assembler';

interface ProviderRuntimeConfig {
  providerUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

interface ProviderCallOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  frequencyPenalty?: number;
  provider?: LlmChatProviderId;
  enableThinking?: boolean;
}

interface ProviderStreamStats {
  sawReasoning: boolean;
  finishReason: string | null;
}

function isLlmChatProviderId(value: unknown): value is LlmChatProviderId {
  return value === 'deepseek' || value === 'siliconflow';
}

function isProviderAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: string; name?: string; message?: string };
  if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
    return true;
  }
  return /aborted|canceled|cancelled/i.test(err.message ?? '');
}

function formatProviderHttpError(
  error: unknown,
  meta: { providerUrl: string; model: string; provider?: LlmChatProviderId }
): Error {
  const axiosError = axios.isAxiosError(error) ? error : null;
  const status =
    axiosError?.response?.status ??
    (error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as { response?: { status?: number } }).response?.status);
  const data =
    axiosError?.response?.data ??
    (error &&
    typeof error === 'object' &&
    'response' in error &&
    (error as { response?: { data?: unknown } }).response?.data);
  let detail = '';
  if (typeof data === 'string') {
    detail = data.slice(0, 500);
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      (record.error &&
        typeof record.error === 'object' &&
        typeof (record.error as { message?: unknown }).message === 'string' &&
        (record.error as { message: string }).message) ||
      '';
    const code = record.code != null ? ` code=${String(record.code)}` : '';
    detail = message ? `${message}${code}` : JSON.stringify(data).slice(0, 500);
  }
  const vendor = meta.provider ?? 'llm';
  const statusPart = status != null ? ` HTTP ${status}` : '';
  const fallbackMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const detailPart = detail ? `: ${detail}` : fallbackMessage ? `: ${fallbackMessage}` : '';
  return new Error(
    `${vendor} 调用失败${statusPart} (model=${meta.model}, url=${meta.providerUrl})${detailPart}`
  );
}

export class GenerationService {
  private readonly traceStore = new TraceStore();

  buildSystemMessage(context: GenerationContext): string {
    return buildSystemMessage(context);
  }

  buildUserMessage(context: GenerationContext, userPrompt: string): string {
    return buildUserMessage(context, userPrompt);
  }

  /** @deprecated 新链路请使用 `buildLlmMessages` */
  buildPrompt(context: GenerationContext, userPrompt: string): string {
    return buildLegacySingleUserPrompt(context, userPrompt);
  }

  buildLlmMessages(context: GenerationContext, userPrompt: string): LlmChatMessage[] {
    return buildLlmMessages(context, userPrompt);
  }

  async createTrace(request: GenerateRequest): Promise<TraceRecord> {
    const context: Record<string, unknown> = { ...(request.context || {}) };
    const providerFromContext = isLlmChatProviderId(context.generation_provider)
      ? context.generation_provider
      : undefined;
    const providerFromRequest = isLlmChatProviderId(request.provider)
      ? request.provider
      : undefined;
    const generationProvider = providerFromContext ?? providerFromRequest;
    if (generationProvider && context.generation_provider === undefined) {
      context.generation_provider = generationProvider;
    }

    const contextMaxTokensRaw = context.maxTokens;
    const contextMaxTokens =
      typeof contextMaxTokensRaw === 'number' && Number.isFinite(contextMaxTokensRaw)
        ? Math.trunc(contextMaxTokensRaw)
        : typeof contextMaxTokensRaw === 'string' && contextMaxTokensRaw.trim()
          ? Number.parseInt(contextMaxTokensRaw, 10)
          : NaN;
    const requestMaxTokens =
      typeof request.maxTokens === 'number' && Number.isFinite(request.maxTokens)
        ? Math.trunc(request.maxTokens)
        : Number.isFinite(contextMaxTokens)
          ? contextMaxTokens
          : undefined;

    const trace: TraceRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: request.projectId,
      prompt: request.prompt,
      context,
      providerType: generationProvider || request.provider || 'deepseek',
      model: request.model || 'deepseek-chat',
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...(typeof request.temperature === 'number' && Number.isFinite(request.temperature)
        ? { temperature: request.temperature }
        : {}),
      ...(typeof requestMaxTokens === 'number' &&
      Number.isFinite(requestMaxTokens) &&
      requestMaxTokens > 0
        ? { maxTokens: requestMaxTokens }
        : {}),
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

  private recordAssembledPrompt(
    trace: TraceRecord,
    systemMessage: string,
    userMessage: string
  ): void {
    logAssembledGenerationPrompt(trace, userMessage, systemMessage);
    this.updateTrace(trace.id, {
      context: {
        systemChars: systemMessage.trim().length,
        userChars: userMessage.length,
      },
    });
  }

  async generateNonStream(trace: TraceRecord, context: GenerationContext): Promise<string> {
    const messages = this.buildLlmMessages(context, trace.prompt);
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? trace.prompt;
    this.recordAssembledPrompt(trace, systemMessage, userMessage);
    this.updateTrace(trace.id, { status: 'generating' });

    const callOptions = this.resolveCallOptionsForTrace(trace);

    try {
      let response = await this.callProviderApi(messages, callOptions);
      if (
        shouldRetryChatWithoutThinking({
          thinkingEnabled: callOptions.enableThinking === true,
          contentEmpty: !response.content.trim(),
        })
      ) {
        response = await this.callProviderApi(messages, {
          ...callOptions,
          enableThinking: false,
        });
      }
      if (!response.content.trim()) {
        throw new Error(formatEmptyChatContentError());
      }
      this.updateTrace(trace.id, {
        status: 'completed',
        result: response.content,
        completedAt: new Date().toISOString(),
        usage: response.usage,
      });
      logGenerationResponse(trace, response.content);
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
    context: GenerationContext,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const messages = this.buildLlmMessages(context, trace.prompt);
    const systemMessage = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? trace.prompt;
    this.recordAssembledPrompt(trace, systemMessage, userMessage);
    this.updateTrace(trace.id, { status: 'generating' });
    let fullContent = '';
    const callOptions = this.resolveCallOptionsForTrace(trace);
    const stats: ProviderStreamStats = { sawReasoning: false, finishReason: null };

    try {
      for await (const chunk of this.callProviderStream(messages, trace, signal, { stats })) {
        if (signal?.aborted) {
          break;
        }
        fullContent += chunk;
        yield chunk;
      }

      if (signal?.aborted) {
        this.updateTrace(trace.id, {
          status: 'failed',
          error: 'aborted',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      if (
        shouldRetryChatWithoutThinking({
          thinkingEnabled: callOptions.enableThinking === true,
          contentEmpty: !fullContent.trim(),
        })
      ) {
        const retryStats: ProviderStreamStats = { sawReasoning: false, finishReason: null };
        for await (const chunk of this.callProviderStream(messages, trace, signal, {
          enableThinking: false,
          stats: retryStats,
        })) {
          if (signal?.aborted) {
            break;
          }
          fullContent += chunk;
          yield chunk;
        }
        if (retryStats.finishReason) {
          stats.finishReason = retryStats.finishReason;
        }
      }

      if (signal?.aborted) {
        this.updateTrace(trace.id, {
          status: 'failed',
          error: 'aborted',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      if (!fullContent.trim()) {
        throw new Error(
          formatEmptyChatContentError({
            sawReasoning: stats.sawReasoning,
            finishReason: stats.finishReason,
          })
        );
      }

      this.updateTrace(trace.id, {
        status: 'completed',
        result: fullContent,
        completedAt: new Date().toISOString(),
      });
      logGenerationResponse(trace, fullContent);
    } catch (error) {
      if (signal?.aborted || isProviderAbortError(error)) {
        this.updateTrace(trace.id, {
          status: 'failed',
          error: 'aborted',
          completedAt: new Date().toISOString(),
        });
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Generation failed';
      this.updateTrace(trace.id, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private resolveUtilityCallProfile() {
    return resolveGenerationCallProfile({ templateKey: '' });
  }

  private resolveCallOptionsForTrace(trace: TraceRecord): ProviderCallOptions {
    const providerId = isLlmChatProviderId(trace.context?.generation_provider)
      ? trace.context.generation_provider
      : undefined;
    const provider = this.resolveProviderConfig(providerId);
    const penaltyRaw = trace.context?.generation_frequency_penalty;
    const frequencyPenalty =
      typeof penaltyRaw === 'number' && Number.isFinite(penaltyRaw) ? penaltyRaw : undefined;
    const temperature =
      typeof trace.temperature === 'number' && Number.isFinite(trace.temperature)
        ? Math.min(2, Math.max(0, trace.temperature))
        : provider.temperature;
    const maxTokens =
      typeof trace.maxTokens === 'number' && Number.isFinite(trace.maxTokens) && trace.maxTokens > 0
        ? Math.trunc(trace.maxTokens)
        : provider.maxTokens;
    const templateKey =
      typeof trace.context?.templateKey === 'string' ? trace.context.templateKey : '';
    return {
      model: trace.model?.trim() || provider.model,
      maxTokens,
      temperature,
      frequencyPenalty,
      provider: providerId,
      enableThinking: shouldEnableChatThinking(templateKey),
    };
  }

  private buildProviderRequestBody(
    messages: LlmChatMessage[],
    provider: ProviderRuntimeConfig,
    options?: ProviderCallOptions
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options?.model ?? provider.model,
      messages,
      max_tokens: options?.maxTokens ?? provider.maxTokens,
      temperature: options?.temperature ?? provider.temperature,
      stream: false,
    };
    if (typeof options?.frequencyPenalty === 'number' && Number.isFinite(options.frequencyPenalty)) {
      body.frequency_penalty = options.frequencyPenalty;
    }
    return body;
  }

  // ─── Provider 适配（DeepSeek / SiliconFlow，OpenAI 兼容 chat/completions）──

  private resolveProviderConfig(provider?: LlmChatProviderId): ProviderRuntimeConfig {
    const maxTokens = Number(process.env.PROVIDER_MAX_TOKENS || 4096);
    const temperature = Number(process.env.PROVIDER_TEMPERATURE || 0.7);

    if (provider) {
      const endpoint = resolveLlmChatProviderEndpoint(provider);
      const defaultModel =
        provider === 'siliconflow' ? 'Qwen/Qwen2.5-7B-Instruct' : 'deepseek-chat';
      return {
        providerUrl: endpoint.providerUrl,
        apiKey: endpoint.apiKey,
        model: process.env.PROVIDER_MODEL || defaultModel,
        maxTokens,
        temperature,
      };
    }

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
      maxTokens,
      temperature,
    };
  }

  // ─── 章节工具类 LLM 任务（无 RAG，单次非流式调用）────────────────────

  buildChapterSummaryPrompt(input: { chapterNo: number; title: string; content: string }): string {
    return [
      ...buildChapterSummaryPromptRules(),
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
    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 512,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    return normalizeChapterSummary(result.content) ?? '';
  }

  buildChapterRelationEventExtractPrompt(input: {
    chapterNo: number;
    title: string;
    content: string;
    protagonist: string;
    personaNames: string[];
  }): string {
    const personaHint = input.personaNames.length > 0 ? input.personaNames.join('、') : '（无）';
    return [
      '你是一位小说编辑，请从以下章节正文中抽取主角与他人之间已发生的关系变化事实。',
      '要求：',
      '1. 只输出 JSON 数组，不要 Markdown 或说明文字',
      '2. 每条包含 counterparty（关联角色名）、summary（≤200字事实短句）、可选 actors（字符串数组）、可选 evidenceSnippet（原文证据1~2句）',
      '3. 若无明确关系变化，返回空数组 []',
      `4. 主角为「${input.protagonist}」，项目已知角色：${personaHint}`,
      '',
      `章节：第${input.chapterNo}章 ${input.title}`,
      '正文：',
      input.content,
    ].join('\n');
  }

  private parseRelationEventsFromModelContent(content: string): Array<{
    counterparty: string;
    actors?: string[];
    summary: string;
    evidenceSnippet?: string;
  }> {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }

    const items = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { events?: unknown[] }).events)
        ? (payload as { events: unknown[] }).events
        : [];

    const events: Array<{
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
    }> = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      const counterparty =
        typeof record.counterparty === 'string' ? record.counterparty.trim() : '';
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      if (!counterparty || !summary) {
        continue;
      }

      const actors = Array.isArray(record.actors)
        ? record.actors
            .map((actor) => (typeof actor === 'string' ? actor.trim() : ''))
            .filter(Boolean)
        : undefined;
      const evidenceSnippet =
        typeof record.evidenceSnippet === 'string' ? record.evidenceSnippet.trim() : undefined;

      events.push({
        counterparty,
        actors: actors && actors.length > 0 ? [...new Set(actors)] : undefined,
        summary,
        evidenceSnippet: evidenceSnippet || undefined,
      });
    }

    return events;
  }

  buildChapterPersonaStatesExtractPrompt(input: {
    chapterNo: number;
    title?: string;
    content: string;
    personas: Array<{
      name: string;
      profile: string;
      state: string;
      priorSnapshot?: Record<string, unknown>;
    }>;
  }): string {
    const roster = input.personas
      .map((persona, index) => {
        const priorParts: string[] = [];
        const prior = persona.priorSnapshot ?? {};
        for (const key of ['clothing', 'appearance', 'status', 'location', 'possessions'] as const) {
          const value = prior[key];
          if (typeof value === 'string' && value.trim()) {
            priorParts.push(`${key}=${value.trim()}`);
          }
        }
        const priorHint =
          priorParts.length > 0 ? priorParts.join('；') : persona.state?.trim() || '暂无';
        return `${index + 1}. ${persona.name}｜历史快照：${priorHint}｜设定摘要：${persona.profile.trim().slice(0, 200)}`;
      })
      .join('\n');

    return [
      '你是小说角色状态跟踪器。请根据章节正文，为名单中的每一位角色输出读完本章后的结构化快照（含着装与瞬时状态）。',
      '要求：',
      '1. 只输出 JSON 对象，不要 Markdown 或解释',
      '2. 格式：{"personas":[{"name":"角色名","appeared":true|false,"snapshot":{"clothing":"...","appearance":"...","status":"...","location":"...","possessions":"..."},"summaryLine":"一句中文摘要"}]}',
      '3. 必须覆盖名单中的每一个 name，不得新增名单外角色',
      '4. snapshot.clothing 为着装；snapshot.status 为情绪/伤势/醉酒等瞬时状态；各字段 <=80 字',
      '5. summaryLine 为一句中文（<=120字），须同时体现着装与状态（若有）',
      '6. 若本章未出场，appeared 为 false，snapshot 可沿用历史快照并在 summaryLine 注明「本章未出场」',
      '7. 若正文未明确换装或形象变化，clothing/appearance 须与历史快照一致',
      '',
      `章节：第${input.chapterNo}章${input.title ? ` ${input.title}` : ''}`,
      '角色名单：',
      roster,
      '',
      '正文：',
      input.content.trim().slice(0, 24000),
    ].join('\n');
  }

  private parseChapterPersonaStatesFromModelContent(content: string): Array<{
    name: string;
    appeared: boolean;
    state: string;
    snapshot?: {
      clothing?: string;
      appearance?: string;
      status?: string;
      location?: string;
      possessions?: string;
    };
    summaryLine?: string;
  }> {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }

    const items = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { personas?: unknown[] }).personas)
        ? (payload as { personas: unknown[] }).personas
        : [];

    const personas: Array<{
      name: string;
      appeared: boolean;
      state: string;
      snapshot?: {
        clothing?: string;
        appearance?: string;
        status?: string;
        location?: string;
        possessions?: string;
      };
      summaryLine?: string;
    }> = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const legacyState = typeof record.state === 'string' ? record.state.trim().slice(0, 120) : '';
      const snapshotRaw =
        record.snapshot && typeof record.snapshot === 'object'
          ? (record.snapshot as Record<string, unknown>)
          : undefined;
      const snapshot = snapshotRaw
        ? {
            clothing:
              typeof snapshotRaw.clothing === 'string'
                ? snapshotRaw.clothing.trim().slice(0, 80)
                : undefined,
            appearance:
              typeof snapshotRaw.appearance === 'string'
                ? snapshotRaw.appearance.trim().slice(0, 80)
                : undefined,
            status:
              typeof snapshotRaw.status === 'string'
                ? snapshotRaw.status.trim().slice(0, 80)
                : undefined,
            location:
              typeof snapshotRaw.location === 'string'
                ? snapshotRaw.location.trim().slice(0, 80)
                : undefined,
            possessions:
              typeof snapshotRaw.possessions === 'string'
                ? snapshotRaw.possessions.trim().slice(0, 80)
                : undefined,
          }
        : undefined;
      const summaryLineRaw =
        typeof record.summaryLine === 'string' ? record.summaryLine.trim().slice(0, 120) : '';
      const summaryLine =
        summaryLineRaw || buildSummaryLineFromSnapshot(snapshot ?? {}) || legacyState;
      if (!name || !summaryLine) {
        continue;
      }
      personas.push({
        name,
        appeared: record.appeared === true,
        state: summaryLine,
        snapshot,
        summaryLine,
      });
    }

    return personas;
  }

  async extractChapterPersonaStates(input: {
    chapterNo: number;
    title?: string;
    content: string;
    personas: Array<{
      name: string;
      profile: string;
      state: string;
      priorSnapshot?: Record<string, unknown>;
    }>;
  }): Promise<
    Array<{
      name: string;
      appeared: boolean;
      state: string;
      snapshot?: {
        clothing?: string;
        appearance?: string;
        status?: string;
        location?: string;
        possessions?: string;
      };
      summaryLine?: string;
    }>
  > {
    if (input.personas.length === 0) {
      return [];
    }

    const prompt = this.buildChapterPersonaStatesExtractPrompt(input);
    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 2048,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    return this.parseChapterPersonaStatesFromModelContent(result.content);
  }

  async extractChapterIdentityRelations(input: {
    chapterNo: number;
    title: string;
    content: string;
    personaNames: string[];
  }): Promise<
    Array<{
      from: string;
      to: string;
      relation: string;
      evidenceSnippet?: string;
    }>
  > {
    const prompt = buildChapterIdentityRelationExtractPrompt(input);
    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 1536,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    return parseIdentityRelationsFromModelContent(result.content);
  }

  async extractChapterRelationEvents(input: {
    chapterNo: number;
    title: string;
    content: string;
    protagonist: string;
    personaNames: string[];
  }): Promise<
    Array<{
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
    }>
  > {
    const prompt = this.buildChapterRelationEventExtractPrompt(input);
    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 2048,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    return this.parseRelationEventsFromModelContent(result.content);
  }

  async extractChapterEventCards(input: {
    chapterNo: number;
    title: string;
    content: string;
    personaNames: string[];
  }): Promise<
    Array<{
      beat: string;
      entities: string[];
      kind: string;
      status: string;
      evidence: string;
    }>
  > {
    const prompt = [
      '你是长篇小说的「跨章记忆」抽取器。',
      '任务：从本章正文抽出 3~8 条后续章节可能回扣的硬事实事件卡。',
      '只抽：能力边界、把柄/承诺、关系转折、未回收伏笔、关键物件/地点规则。',
      '不要抽：氛围、床戏感官堆叠、形容词描写。',
      '只输出 JSON：{"cards":[{"beat":"≤80字硬事实","entities":["人物"],"kind":"foreshadow|relation|ability|promise|object|other","status":"open|paid|fact","evidence":"原文锚点80~200字"}]}',
      'foreshadow/promise 默认 status=open；其它默认 fact。',
      '',
      `章节：第${input.chapterNo}章「${input.title}」`,
      input.personaNames.length ? `已知人物：${input.personaNames.join('、')}` : '',
      '正文：',
      input.content.trim().slice(0, 24000),
    ]
      .filter(Boolean)
      .join('\n');

    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 2048,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    return this.parseEventCardsFromModelContent(result.content);
  }

  private parseEventCardsFromModelContent(content: string): Array<{
    beat: string;
    entities: string[];
    kind: string;
    status: string;
    evidence: string;
  }> {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;
    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
    const list = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { cards?: unknown }).cards)
        ? ((payload as { cards: unknown[] }).cards ?? [])
        : [];
    const out: Array<{
      beat: string;
      entities: string[];
      kind: string;
      status: string;
      evidence: string;
    }> = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      const beat = typeof record.beat === 'string' ? record.beat.trim().slice(0, 80) : '';
      if (!beat) {
        continue;
      }
      const entities = Array.isArray(record.entities)
        ? record.entities
            .map((e) => (typeof e === 'string' ? e.trim() : ''))
            .filter(Boolean)
            .slice(0, 12)
        : [];
      out.push({
        beat,
        entities,
        kind: typeof record.kind === 'string' ? record.kind : 'other',
        status: typeof record.status === 'string' ? record.status : 'fact',
        evidence: typeof record.evidence === 'string' ? record.evidence.trim().slice(0, 200) : '',
      });
      if (out.length >= 8) {
        break;
      }
    }
    return out;
  }

  buildStructuredInfoExtractPrompt(input: {
    mode: 'workbench' | 'chapter';
    sourceText: string;
  }): string {
    const modeHint =
      input.mode === 'workbench'
        ? '输入为「本章写作目标」相关字段（目标、视角、必须包含、避免等），请提炼用于知识库**文档标题**匹配的短语文本。'
        : '输入为「章节正文」节选，请提炼情节要素用于知识库**文档标题**匹配的短语文本。';
    return [
      '你是小说创作辅助系统中的信息抽取器。',
      modeHint,
      '要求：',
      '1. 只输出 JSON 对象，不要 Markdown 或解释',
      '2. 字段：matchingText（字符串，50~300 字，中文，尽量包含可能出现在设定文档标题中的实体与主题词，用顿号或空格分隔多个概念）',
      '3. 字段：keywords（字符串数组，5~20 个短词或专有名词）',
      '4. 字段：narrativeSummary（可选，≤120 字，概括输入核心意图，供作者核对）',
      '5. 若输入几乎为空，matchingText 可为空字符串，keywords 为空数组',
      '',
      '输入：',
      input.sourceText.trim().slice(0, 24000),
    ].join('\n');
  }

  private parseStructuredInfoFromModelContent(content: string): {
    matchingText: string;
    keywords: string[];
    narrativeSummary?: string;
  } {
    const trimmed = content.trim();
    if (!trimmed) {
      return { matchingText: '', keywords: [] };
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return { matchingText: '', keywords: [] };
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { matchingText: '', keywords: [] };
    }

    const record = payload as Record<string, unknown>;
    const matchingText =
      typeof record.matchingText === 'string' ? record.matchingText.trim().slice(0, 2000) : '';
    const keywords = Array.isArray(record.keywords)
      ? record.keywords
          .map((k) => (typeof k === 'string' ? k.trim() : ''))
          .filter(Boolean)
          .slice(0, 40)
      : [];
    const narrativeSummary =
      typeof record.narrativeSummary === 'string'
        ? record.narrativeSummary.trim().slice(0, 200)
        : undefined;

    return {
      matchingText,
      keywords: [...new Set(keywords)],
      narrativeSummary: narrativeSummary || undefined,
    };
  }

  /**
   * 容错：模型失败或 JSON 无效时，用输入前 400 字作为 matchingText。
   */
  fallbackStructuredInfoFromSourceText(sourceText: string): {
    matchingText: string;
    keywords: string[];
    narrativeSummary?: string;
  } {
    const t = sourceText.replace(/\s+/g, ' ').trim();
    return {
      matchingText: t.slice(0, 400),
      keywords: [],
      narrativeSummary: '（解析降级：已使用原文前缀作为匹配文本）',
    };
  }

  async extractStructuredInfo(input: {
    mode: 'workbench' | 'chapter';
    sourceText: string;
  }): Promise<{
    matchingText: string;
    keywords: string[];
    narrativeSummary?: string;
  }> {
    const raw = input.sourceText.trim();
    if (!raw) {
      return { matchingText: '', keywords: [] };
    }

    const prompt = this.buildStructuredInfoExtractPrompt(input);
    const profile = this.resolveUtilityCallProfile();
    const result = await this.callProviderApi(prompt, {
      maxTokens: 1024,
      temperature: profile.temperature,
      model: profile.model,
      provider: profile.provider,
    });
    const parsed = this.parseStructuredInfoFromModelContent(result.content);
    if (!parsed.matchingText.trim() && parsed.keywords.length === 0) {
      return this.fallbackStructuredInfoFromSourceText(raw);
    }
    if (!parsed.matchingText.trim() && parsed.keywords.length > 0) {
      return {
        ...parsed,
        matchingText: parsed.keywords.join(' ').slice(0, 2000),
      };
    }
    return parsed;
  }

  private async callProviderApi(
    promptOrMessages: string | LlmChatMessage[],
    options?: ProviderCallOptions
  ): Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const provider = this.resolveProviderConfig(options?.provider);
    const messages =
      typeof promptOrMessages === 'string'
        ? [{ role: 'user' as const, content: promptOrMessages }]
        : promptOrMessages;
    const body = withChatThinkingMode(
      this.buildProviderRequestBody(
        messages,
        provider,
        {
          ...options,
          maxTokens: applyThinkingTokenReserve(
            options?.maxTokens ?? provider.maxTokens,
            options?.enableThinking === true
          ),
        }
      ),
      options?.enableThinking ? 'enabled' : 'disabled'
    );
    const model = String(body.model ?? provider.model);

    try {
      const response = await axios.post(provider.providerUrl, body, {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180000,
      });

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
    } catch (error) {
      throw formatProviderHttpError(error, {
        providerUrl: provider.providerUrl,
        model,
        provider: options?.provider,
      });
    }
  }

  private streamParamsForTrace(trace: TraceRecord): ProviderCallOptions {
    return this.resolveCallOptionsForTrace(trace);
  }

  private async *callProviderStream(
    messages: LlmChatMessage[],
    trace: TraceRecord,
    signal?: AbortSignal,
    extras?: { enableThinking?: boolean; stats?: ProviderStreamStats }
  ): AsyncGenerator<string, void, unknown> {
    if (signal?.aborted) {
      return;
    }

    const callOptions = this.streamParamsForTrace(trace);
    const thinkingEnabled =
      typeof extras?.enableThinking === 'boolean'
        ? extras.enableThinking
        : Boolean(callOptions.enableThinking);
    const providerId =
      callOptions.provider ??
      (isLlmChatProviderId(trace.context?.generation_provider)
        ? trace.context.generation_provider
        : undefined);
    const provider = this.resolveProviderConfig(providerId);

    const streamBody = withChatThinkingMode(
      {
        model: callOptions.model ?? provider.model,
        messages,
        max_tokens: applyThinkingTokenReserve(
          callOptions.maxTokens ?? provider.maxTokens,
          thinkingEnabled
        ),
        temperature: callOptions.temperature ?? provider.temperature,
        stream: true,
      },
      thinkingEnabled ? 'enabled' : 'disabled'
    );
    if (
      typeof callOptions.frequencyPenalty === 'number' &&
      Number.isFinite(callOptions.frequencyPenalty)
    ) {
      streamBody.frequency_penalty = callOptions.frequencyPenalty;
    }

    let response;
    try {
      response = await axios.post(provider.providerUrl, streamBody, {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        // 长章节流式生成可能远超 120s；首包慢时不应被总时长误杀（各环境对 stream+timeout 语义不一致）
        timeout: 0,
        validateStatus: () => true,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted || isProviderAbortError(error)) {
        return;
      }
      throw error;
    }

    if (response.status >= 400) {
      const chunks: Buffer[] = [];
      for await (const chunk of response.data as NodeJS.ReadableStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // keep raw text
      }
      throw formatProviderHttpError(
        { response: { status: response.status, data: parsed } },
        {
          providerUrl: provider.providerUrl,
          model: String(streamBody.model ?? provider.model),
          provider: providerId,
        }
      );
    }

    const stream = response.data as NodeJS.ReadableStream;
    const destroyStream = () => {
      const destroyable = stream as NodeJS.ReadableStream & {
        destroy?: (error?: Error) => void;
      };
      try {
        destroyable.destroy?.();
      } catch {
        // ignore
      }
    };
    const onAbort = () => destroyStream();
    if (signal) {
      if (signal.aborted) {
        destroyStream();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const utf8 = createUtf8StreamDecoder();
    let lineBuffer = '';

    try {
      for await (const chunk of stream) {
        if (signal?.aborted) {
          return;
        }
        const consumed = consumeProviderSseStreamChunk(
          lineBuffer,
          utf8.decode(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        );
        lineBuffer = consumed.nextBuffer;

        for (const event of consumed.events) {
          if (event.type === 'done') {
            return;
          }
          if (event.type === 'reasoning') {
            if (extras?.stats) {
              extras.stats.sawReasoning = true;
              if (event.finishReason) {
                extras.stats.finishReason = event.finishReason;
              }
            }
            continue;
          }
          if (event.type === 'content') {
            if (extras?.stats && event.finishReason) {
              extras.stats.finishReason = event.finishReason;
            }
            yield event.content;
            continue;
          }
          if (event.type === 'skip' && extras?.stats && event.finishReason) {
            extras.stats.finishReason = event.finishReason;
          }
          if (event.type === 'malformed') {
            console.error('[callProviderStream] malformed SSE line after reassembly', {
              traceId: trace.id,
              error: event.error,
              linePreview: event.data.slice(0, 200),
              lineLength: event.data.length,
            });
          }
        }
      }

      lineBuffer += utf8.flush();
      const flushed = flushProviderSseStreamBuffer(lineBuffer);
      for (const event of flushed.events) {
        if (event.type === 'done') {
          return;
        }
        if (event.type === 'reasoning') {
          if (extras?.stats) {
            extras.stats.sawReasoning = true;
            if (event.finishReason) {
              extras.stats.finishReason = event.finishReason;
            }
          }
          continue;
        }
        if (event.type === 'content') {
          if (extras?.stats && event.finishReason) {
            extras.stats.finishReason = event.finishReason;
          }
          yield event.content;
          continue;
        }
        if (event.type === 'skip' && extras?.stats && event.finishReason) {
          extras.stats.finishReason = event.finishReason;
        }
        if (event.type === 'malformed') {
          console.error('[callProviderStream] malformed SSE line in stream tail', {
            traceId: trace.id,
            error: event.error,
            linePreview: event.data.slice(0, 200),
            lineLength: event.data.length,
          });
        }
      }
    } catch (error) {
      if (signal?.aborted || isProviderAbortError(error)) {
        return;
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
