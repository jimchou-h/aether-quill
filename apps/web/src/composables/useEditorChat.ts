import { computed, readonly, ref, shallowRef } from 'vue';

import type {
  EditorChatEndEvent,
  EditorChatHistoryMessage,
  SseStreamOptions,
} from '../services/api';

export interface EditorChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 送入模型的历史按最近若干条截断；服务端仍会独立二次限额。 */
const HISTORY_WINDOW_MESSAGES = 24;

export interface EditorChatApi {
  streamEditorChat(
    projectId: string,
    payload: {
      question: string;
      history?: EditorChatHistoryMessage[];
      currentChapterNo?: number;
    },
    callbacks: {
      onContent?: (text: string) => void;
      onEnd?: (event: EditorChatEndEvent) => void;
      onError?: (message: string) => void;
    },
    options?: SseStreamOptions
  ): Promise<void>;
}

export interface EditorChatSnapshot {
  messages: EditorChatMessage[];
  currentChapterNo: number | null;
}

export function useEditorChat(input: {
  projectId: string;
  api: EditorChatApi;
  /** 每次「可持久化」的状态变化后回调（流式分片不触发，避免逐字写库）。 */
  onSnapshot?: (snapshot: EditorChatSnapshot) => void;
}) {
  const messages = shallowRef<EditorChatMessage[]>([]);
  const streaming = ref(false);
  const error = ref('');
  const currentChapterNo = ref<number | null>(null);

  /**
   * 代际计数：清空 / 切换会话时自增。
   * 在途流的每个写回点都比对这个值，过期回调一律丢弃。
   */
  let generation = 0;
  let inflight: AbortController | null = null;

  function snapshot(): EditorChatSnapshot {
    return { messages: messages.value, currentChapterNo: currentChapterNo.value };
  }

  function emitSnapshot() {
    input.onSnapshot?.(snapshot());
  }

  function buildHistory(): EditorChatHistoryMessage[] {
    return messages.value
      .slice(-HISTORY_WINDOW_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  /** 从本地存储恢复：仅用于空会话，绝不覆盖正在进行的对话。 */
  function hydrate(restored: EditorChatSnapshot) {
    if (streaming.value || messages.value.length > 0) {
      return;
    }
    messages.value = restored.messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    currentChapterNo.value = restored.currentChapterNo;
    emitSnapshot();
  }

  /** 清空当前聊天：中止在途生成 + 丢弃其所有后续写回。 */
  function clear() {
    generation += 1;
    inflight?.abort();
    inflight = null;
    messages.value = [];
    error.value = '';
    currentChapterNo.value = null;
    streaming.value = false;
    emitSnapshot();
  }

  async function send(question: string): Promise<boolean> {
    const trimmed = (question ?? '').trim();
    if (!trimmed) {
      return false;
    }
    if (streaming.value) {
      return false;
    }

    const history = buildHistory();
    messages.value = [...messages.value, { role: 'user', content: trimmed }];
    emitSnapshot();

    streaming.value = true;
    error.value = '';

    const ownGeneration = generation;
    const controller = new AbortController();
    inflight = controller;

    let answer = '';
    let failed = false;
    let assistantStarted = false;
    const writeAssistant = () => {
      // 清空/切换后的迟到回调不得写回旧会话
      if (ownGeneration !== generation) {
        return;
      }
      const base = assistantStarted ? messages.value.slice(0, -1) : messages.value;
      assistantStarted = true;
      messages.value = [...base, { role: 'assistant', content: answer }];
    };

    try {
      await input.api.streamEditorChat(
        input.projectId,
        {
          question: trimmed,
          history: history.length > 0 ? history : undefined,
          currentChapterNo: currentChapterNo.value ?? undefined,
        },
        {
          onContent: (piece) => {
            answer += piece;
            writeAssistant();
          },
          onEnd: (event) => {
            if (ownGeneration !== generation) {
              return;
            }
            if (typeof event.chapterNo === 'number' && event.chapterNo > 0) {
              currentChapterNo.value = event.chapterNo;
            }
            writeAssistant();
          },
          onError: (message) => {
            if (ownGeneration !== generation) {
              return;
            }
            failed = true;
            error.value = message;
            writeAssistant();
          },
        },
        { signal: controller.signal }
      );
    } catch (err) {
      if (ownGeneration === generation) {
        failed = true;
        error.value = err instanceof Error ? err.message : '编辑对话请求失败';
        writeAssistant();
      }
    } finally {
      // 会话已被清空/切换：本轮既没有答案也不算业务失败，一律报告未完成
      if (ownGeneration !== generation) {
        failed = true;
      } else {
        streaming.value = false;
        if (inflight === controller) {
          inflight = null;
        }
        emitSnapshot();
      }
    }
    return !failed;
  }

  return {
    messages: readonly(messages),
    streaming: readonly(streaming),
    error: readonly(error),
    currentChapterNo: readonly(currentChapterNo),
    hasMessages: computed(() => messages.value.length > 0),
    send,
    clear,
    hydrate,
    snapshot,
  };
}
