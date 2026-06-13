/**
 * 生成 Trace 持久化 — 记录每次 LLM 调用的 prompt、上下文、状态与用量
 *
 * 默认写入 `data/traces.json`（进程内 + 文件双写），供前端追溯引用证据与检索 query。
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
    result?: string;
    providerType: string;
    model: string;
    status: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    createdAt: string;
    completedAt?: string;
    error?: string;
  }>;
}

export class TraceStore {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'traces.json');
  private traces: TraceRecord[] = [];
  private readonly maxTraces = 10000;
  private readonly autoSaveInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.restoreFromDisk();
    this.autoSaveInterval = setInterval(() => this.persist(), 60000);
  }

  push(trace: TraceRecord): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-this.maxTraces);
    }
    this.persist();
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
    this.persist();
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
    if (removed > 0) this.persist();
    return removed;
  }

  close(): void {
    clearInterval(this.autoSaveInterval);
    this.persist();
  }

  private persist(): void {
    const payload: PersistedTracesState = {
      traces: this.traces.map((t) => ({
        ...t,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
    };

    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private restoreFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTracesState;
      this.traces = (parsed.traces || []).map((t) => ({
        ...t,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
        status: t.status as TraceRecord['status'],
      }));
    } catch {
      this.traces = [];
    }
  }
}
