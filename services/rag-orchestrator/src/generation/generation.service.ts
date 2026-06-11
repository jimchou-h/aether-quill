import axios from 'axios';
import {
  hasMultiPersonaCardEvidence,
  MULTI_PERSONA_WRITING_GUARD,
  PERSONA_APPEARANCE_CONTINUITY_GUARD,
} from '../retrieval/persona-card-evidence';
import { TraceRecord, GenerateRequest } from './types';
import { consumeProviderSseStreamChunk, flushProviderSseStreamBuffer } from './provider-sse-stream';
import { TraceStore, TraceQuery, TraceStats } from './trace-store';
import {
  buildChapterIdentityRelationExtractPrompt,
  parseIdentityRelationsFromModelContent,
} from './identity-relation-extract';
import { buildSummaryLineFromSnapshot } from '../context/persona-snapshot';

export interface GenerationContext {
  /** 项目级 systemPromptText（Settings） */
  systemPromptText: string;
  /**
   * 叙事上下文：人物 + 大纲 + 近期章节摘要 + 已选关系备忘（不含向量检索证据）。
   * 与 `retrievedEvidence` 分段拼装，对应模板占位 `{{narrativeContext}}` 语义。
   */
  narrativeContext: string;
  /** 向量检索 + 重排后的证据块，对应 `{{retrievedEvidence}}` */
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

    if (context.systemPromptText?.trim()) {
      sections.push(`【系统指令】\n${context.systemPromptText.trim()}`);
    }
    if (context.narrativeContext?.trim()) {
      let narrative = context.narrativeContext.trim();
      if (narrative.includes('【人物当前快照】')) {
        narrative = `${PERSONA_APPEARANCE_CONTINUITY_GUARD}\n\n${narrative}`;
      }
      sections.push(`【叙事上下文】\n${narrative}`);
    }
    if (context.retrievedEvidence?.trim()) {
      let evidence = context.retrievedEvidence.trim();
      if (hasMultiPersonaCardEvidence(evidence)) {
        evidence = `${MULTI_PERSONA_WRITING_GUARD}\n\n${evidence}`;
      }
      sections.push(`【检索证据】\n${evidence}`);
      console.log(evidence);
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
      ...(typeof request.temperature === 'number' && Number.isFinite(request.temperature)
        ? { temperature: request.temperature }
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

  async generateNonStream(trace: TraceRecord, context: GenerationContext): Promise<string> {
    const prompt = this.buildPrompt(context, trace.prompt);
    this.updateTrace(trace.id, { status: 'generating' });

    const provider = this.resolveProviderConfig();
    const temperature =
      typeof trace.temperature === 'number' && Number.isFinite(trace.temperature)
        ? Math.min(2, Math.max(0, trace.temperature))
        : provider.temperature;

    try {
      const response = await this.callProviderApi(prompt, {
        maxTokens: provider.maxTokens,
        temperature,
      });
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
      for await (const chunk of this.callProviderStream(prompt, trace)) {
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
      '你是一位小说编辑，请为以下章节正文生成一段详细的中文语义摘要。',
      '要求：',
      '1. 概括主要情节、冲突与结果，保留关键角色互动与状态变化',
      '2. 标注本章涉及的角色名称及其行为动机',
      '3. 单独列出主要出场人物的着装与瞬时状态（无变化则写「维持」）',
      '4. 如有伏笔或悬念，简要提及',
      '5. 控制在 300~500 字',
      '6. 只输出摘要正文，不要标题、编号或解释',
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
      maxTokens: 1536,
      temperature: 0.3,
    });
    return result.content.trim();
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
    const result = await this.callProviderApi(prompt, {
      maxTokens: 2048,
      temperature: 0.2,
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
    const result = await this.callProviderApi(prompt, {
      maxTokens: 1536,
      temperature: 0.2,
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
    const result = await this.callProviderApi(prompt, {
      maxTokens: 2048,
      temperature: 0.2,
    });
    return this.parseRelationEventsFromModelContent(result.content);
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
    const result = await this.callProviderApi(prompt, {
      maxTokens: 1024,
      temperature: 0.2,
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

  private streamParamsForTrace(trace: TraceRecord): { maxTokens: number; temperature: number } {
    const provider = this.resolveProviderConfig();
    const t =
      typeof trace.temperature === 'number' && Number.isFinite(trace.temperature)
        ? trace.temperature
        : provider.temperature;
    return {
      maxTokens: provider.maxTokens,
      temperature: Math.min(2, Math.max(0, t)),
    };
  }

  private async *callProviderStream(
    prompt: string,
    trace: TraceRecord
  ): AsyncGenerator<string, void, unknown> {
    const provider = this.resolveProviderConfig();
    const { maxTokens, temperature } = this.streamParamsForTrace(trace);

    const response = await axios.post(
      provider.providerUrl,
      {
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        stream: true,
      },
      {
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'stream',
        // 长章节流式生成可能远超 120s；首包慢时不应被总时长误杀（各环境对 stream+timeout 语义不一致）
        timeout: 0,
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    let lineBuffer = '';

    for await (const chunk of stream) {
      const consumed = consumeProviderSseStreamChunk(lineBuffer, chunk.toString('utf-8'));
      lineBuffer = consumed.nextBuffer;

      for (const event of consumed.events) {
        if (event.type === 'done') {
          return;
        }
        if (event.type === 'content') {
          yield event.content;
          continue;
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

    const flushed = flushProviderSseStreamBuffer(lineBuffer);
    for (const event of flushed.events) {
      if (event.type === 'done') {
        return;
      }
      if (event.type === 'content') {
        yield event.content;
        continue;
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
  }
}
