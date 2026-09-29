import type { Ref } from 'vue';

export interface ThrottledTextSink {
  /** 追加流式片段；按 interval 合批写入目标 ref */
  append(text: string): void;
  /** 立刻替换全文（清空未刷缓冲） */
  replace(text: string): void;
  /** 把未刷出的片段立刻写入 */
  flush(): void;
  /** 丢弃定时器与未刷缓冲（不改目标已有内容） */
  dispose(): void;
}

/**
 * 把高频 SSE 追加合批后再写进 Vue ref，避免每个 token 都触发整章 textarea 重排。
 */
export function createThrottledTextSink(
  target: Ref<string>,
  options?: { intervalMs?: number }
): ThrottledTextSink {
  const intervalMs = Math.max(16, options?.intervalMs ?? 120);
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (!pending) {
      return;
    }
    const chunk = pending;
    pending = '';
    target.value += chunk;
  };

  return {
    append(text: string) {
      if (!text) {
        return;
      }
      pending += text;
      if (timer == null) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    replace(text: string) {
      clearTimer();
      pending = '';
      target.value = text;
    },
    flush,
    dispose() {
      clearTimer();
      pending = '';
    },
  };
}
