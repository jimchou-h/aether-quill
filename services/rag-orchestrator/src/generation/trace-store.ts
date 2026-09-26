/**
 * 生成 Trace 持久化 — 记录每次 LLM 调用的 prompt、上下文、状态与用量
 *
 * 默认写入 `data/traces.json`（进程内 + 文件双写），供追溯用量与检索元数据。
 * 不落盘完整 prompt / 模型返回；合并写入、不 pretty-print，只留最近若干条。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TraceRecord } from './types';

export interface TraceQuery {
  projectId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface TraceStats {
  total: number;
  completed: number;
  failed: number;
  generating: number;
  pending: number;
  avgTokensPerTrace: number;
  totalTokens: number;
}

interface PersistedTracesState {
  traces: Array<{
    id: string;
    projectId: string;
    prompt: string;
    context: Record<string, unknown>;
    providerType: string;
    model: string;
    status: string;
    temperature?: number;
    maxTokens?: number;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    createdAt: string;
    completedAt?: string;
    error?: string;
  }>;
}

/** 这些字段动辄数万字，落盘/热路径序列化会堵住事件循环。 */
export const TRACE_BULKY_CONTEXT_KEYS = [
  'assembled_prompt',
  'user_message',
  'system_message',
] as const;

/** 落盘 context 里单段字符串上限；超长改成占位，避免角色卡全文再次把 traces.json 撑爆。 */
export const TRACE_CONTEXT_PERSIST_MAX_CHARS = 500;

const BULKY_CONTEXT_KEY_SET = new Set<string>(TRACE_BULKY_CONTEXT_KEYS);

export function omitBulkyTraceContext(
  context: Record<string, unknown> | undefined
): Record<string, unknown> {
  return sanitizePersistedValue(context || {}, 0) as Record<string, unknown>;
}

function sanitizePersistedValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return '[omitted nested]';
  }
  if (typeof value === 'string') {
    if (value.length <= TRACE_CONTEXT_PERSIST_MAX_CHARS) {
      return value;
    }
    return `[omitted ${value.length} chars]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePersistedValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (BULKY_CONTEXT_KEY_SET.has(key)) {
        continue;
      }
      out[key] = sanitizePersistedValue(nested, depth + 1);
    }
    return out;
  }
  return value;
}

export function toPersistedTrace(trace: TraceRecord): PersistedTracesState['traces'][number] {
  return {
    id: trace.id,
    projectId: trace.projectId,
    prompt: '',
    context: omitBulkyTraceContext(trace.context),
    providerType: trace.providerType,
    model: trace.model,
    status: trace.status,
    ...(typeof trace.temperature === 'number' ? { temperature: trace.temperature } : {}),
    ...(typeof trace.maxTokens === 'number' ? { maxTokens: trace.maxTokens } : {}),
    usage: trace.usage,
    createdAt: trace.createdAt,
    completedAt: trace.completedAt,
    error: trace.error,
  };
}

/** 磁盘只留最近若干条，避免 pretty-print 整库把事件循环堵住。 */
export const TRACE_STORE_MAX_PERSISTED = 300;
export const TRACE_STORE_PERSIST_DEBOUNCE_MS = 2000;

export class TraceStore {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'traces.json');
  private traces: TraceRecord[] = [];
  private readonly maxTraces = 10000;
  private readonly autoSaveInterval: ReturnType<typeof setInterval>;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.restoreFromDisk();
    this.autoSaveInterval = setInterval(() => this.persist(), 60_000);
  }

  push(trace: TraceRecord): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }
    this.schedulePersist();
  }

  update(traceId: string, updates: Partial<TraceRecord>): void {
    const trace = this.traces.find((t) => t.id === traceId);
    if (!trace) {
      return;
    }
    const { context: incomingContext, ...rest } = updates;
    if (incomingContext && typeof incomingContext === 'object') {
      trace.context = { ...(trace.context || {}), ...incomingContext };
    }
    Object.assign(trace, rest);
    this.schedulePersist();
  }

  findById(traceId: string): TraceRecord | undefined {
    return this.traces.find((t) => t.id === traceId);
  }

  query(query: TraceQuery): { data: TraceRecord[]; total: number } {
    let filtered = [...this.traces];

    if (query.projectId) {
      filtered = filtered.filter((t) => t.projectId === query.projectId);
    }
    if (query.status) {
      filtered = filtered.filter((t) => t.status === query.status);
    }
    if (query.startDate) {
      const start = new Date(query.startDate).getTime();
      filtered = filtered.filter((t) => new Date(t.createdAt).getTime() >= start);
    }
    if (query.endDate) {
      const end = new Date(query.endDate).getTime();
      filtered = filtered.filter((t) => new Date(t.createdAt).getTime() <= end);
    }

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const offset = query.offset || 0;
    const limit = query.limit || 20;
    const data = filtered.slice(offset, offset + limit);

    return { data, total };
  }

  getStats(projectId?: string): TraceStats {
    const filtered = projectId ? this.traces.filter((t) => t.projectId === projectId) : this.traces;

    const completed = filtered.filter((t) => t.status === 'completed');
    const totalTokens = completed.reduce((sum, t) => sum + (t.usage?.totalTokens || 0), 0);

    return {
      total: filtered.length,
      completed: completed.length,
      failed: filtered.filter((t) => t.status === 'failed').length,
      generating: filtered.filter((t) => t.status === 'generating').length,
      pending: filtered.filter((t) => t.status === 'pending').length,
      avgTokensPerTrace: completed.length > 0 ? Math.round(totalTokens / completed.length) : 0,
      totalTokens,
    };
  }

  removeOldTraces(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const before = this.traces.length;
    this.traces = this.traces.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
    const removed = before - this.traces.length;
    if (removed > 0) this.schedulePersist();
    return removed;
  }

  close(): void {
    clearInterval(this.autoSaveInterval);
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, TRACE_STORE_PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    const persisted = this.traces.slice(-TRACE_STORE_MAX_PERSISTED);
    const payload: PersistedTracesState = {
      traces: persisted.map((t) => toPersistedTrace(t)),
    };

    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload), 'utf8');
  }

  private restoreFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTracesState;
      this.traces = (parsed.traces || []).map((t) => ({
        id: t.id,
        projectId: t.projectId,
        prompt: '',
        context: omitBulkyTraceContext(t.context),
        providerType: t.providerType,
        model: t.model,
        status: t.status as TraceRecord['status'],
        temperature: t.temperature,
        maxTokens: t.maxTokens,
        usage: t.usage,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        error: t.error,
      }));
    } catch {
      this.traces = [];
    }
  }
}
