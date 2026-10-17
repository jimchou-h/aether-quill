/**
 * 章节精修 run 的进程内事件总线（AQ-380）。
 *
 * 观察与执行解耦：SSE 订阅只读总线，断开不取消后台 run。
 * `seq` 仅在当前 attempt 内单调递增；重连客户端按 (attemptId, seq) 去重。
 */

export type RefinementStreamEventName = 'snapshot' | 'stage' | 'paused' | 'finished' | 'error';

export interface RefinementStreamEventInput {
  event: RefinementStreamEventName;
  revision: number;
  attemptId: string | null;
  payload?: Record<string, unknown>;
}

export type RefinementStreamEventListener = (event: Record<string, unknown>) => void;

interface RunStreamState {
  attemptId: string | null;
  seq: number;
  listeners: Set<RefinementStreamEventListener>;
}

export class ChapterRefinementEventBus {
  private readonly runs = new Map<string, RunStreamState>();

  subscribe(runId: string, listener: RefinementStreamEventListener): () => void {
    const state = this.getOrCreate(runId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  publish(runId: string, input: RefinementStreamEventInput): void {
    const state = this.getOrCreate(runId);
    if (state.attemptId !== input.attemptId) {
      state.attemptId = input.attemptId;
      state.seq = 0;
    }
    state.seq += 1;
    const event: Record<string, unknown> = {
      event: input.event,
      runId,
      revision: input.revision,
      attemptId: input.attemptId,
      seq: state.seq,
      ...(input.payload ?? {}),
    };
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者异常不影响其他订阅者与后台 run
      }
    }
  }

  /** 运行终态后释放订阅集合，避免长驻内存 */
  release(runId: string): void {
    this.runs.delete(runId);
  }

  clearForTest(): void {
    this.runs.clear();
  }

  private getOrCreate(runId: string): RunStreamState {
    const existing = this.runs.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunStreamState = { attemptId: null, seq: 0, listeners: new Set() };
    this.runs.set(runId, created);
    return created;
  }
}
