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

export function useEditorChat(input: { projectId: string; api: EditorChatApi }) {
  const messages = shallowRef<EditorChatMessage[]>([]);
  const streaming = ref(false);
  const error = ref('');
  const currentChapterNo = ref<number | null>(null);

  function buildHistory(): EditorChatHistoryMessage[] {
    return messages.value
      .slice(-HISTORY_WINDOW_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));
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

    streaming.value = true;
    error.value = '';

    let answer = '';
    let failed = false;
    let assistantStarted = false;
    const writeAssistant = () => {
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
            if (typeof event.chapterNo === 'number' && event.chapterNo > 0) {
              currentChapterNo.value = event.chapterNo;
            }
            writeAssistant();
          },
          onError: (message) => {
            failed = true;
            error.value = message;
            writeAssistant();
          },
        }
      );
    } catch (err) {
      failed = true;
      error.value = err instanceof Error ? err.message : '编辑对话请求失败';
      writeAssistant();
    } finally {
      streaming.value = false;
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
  };
}
