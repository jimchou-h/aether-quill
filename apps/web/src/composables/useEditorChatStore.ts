import { computed, ref, shallowRef } from 'vue';

import { apiClient } from '../services/api';
import {
  createEditorChatIdbStorage,
  editorChatSessionKey,
  type EditorChatSessionRecord,
  type EditorChatStorage,
} from '../services/editorChatStorage';
import { useEditorChat, type EditorChatApi, type EditorChatSnapshot } from './useEditorChat';

export interface EditorChatSession {
  userId: string;
  projectId: string;
  /** IndexedDB 记录键：`userId:projectId`，一个账号在一个项目里只有一段当前聊天。 */
  key: string;
  chat: ReturnType<typeof useEditorChat>;
  /** 切走后置真：在途流的中止与清理不得再写回这个会话的记录。 */
  detached: boolean;
}

/**
 * 项目级编辑对话共享状态：悬浮入口与面板共用同一实例，
 * 收起与项目内路由切换不重置会话，并按账号+项目落 IndexedDB（issue #48）。
 */
export function createEditorChatStore(input: { api: EditorChatApi; storage: EditorChatStorage }) {
  const open = ref(false);
  const current = shallowRef<EditorChatSession | null>(null);

  function persist(session: EditorChatSession, next: EditorChatSnapshot) {
    if (session.detached || !session.userId) {
      return;
    }
    const record: EditorChatSessionRecord = {
      key: session.key,
      messages: next.messages,
      currentChapterNo: next.currentChapterNo,
      updatedAt: new Date().toISOString(),
    };
    void input.storage.save(record);
  }

  function detach(session: EditorChatSession) {
    // 先断持久化再 clear：清空只应作用于新会话，不能抹掉旧项目的记录
    session.detached = true;
    session.chat.clear();
  }

  async function ensureSession(next: { userId: string; projectId: string }): Promise<void> {
    const key = editorChatSessionKey(next.userId, next.projectId);
    if (current.value?.key === key) {
      return;
    }
    if (current.value) {
      detach(current.value);
    }

    // onSnapshot 只在会话建好之后才回调，所以可以在声明 session 之前引用它
    const chat = useEditorChat({
      projectId: next.projectId,
      api: input.api,
      onSnapshot: (snapshot) => persist(session, snapshot),
    });
    const session: EditorChatSession = {
      userId: next.userId,
      projectId: next.projectId,
      key,
      chat,
      detached: false,
    };
    current.value = session;

    if (!next.userId) {
      // 用户身份尚未就绪（刷新后 me 未返回）：先给一个空会话，等 userId 到位再恢复
      return;
    }

    const record = await input.storage.load(key);
    if (current.value?.key !== key || !record) {
      return;
    }
    chat.hydrate({
      messages: record.messages,
      currentChapterNo: record.currentChapterNo,
    });
  }

  function clearCurrent() {
    const session = current.value;
    if (!session) {
      return;
    }
    session.chat.clear();
    if (session.userId) {
      void input.storage.remove(session.key);
    }
  }

  function toggle() {
    open.value = !open.value;
  }

  return { open, current, ensureSession, clearCurrent, toggle };
}

const store = createEditorChatStore({
  api: apiClient,
  storage: createEditorChatIdbStorage(),
});

export function useEditorChatStore() {
  return {
    open: store.open,
    chat: computed(() => store.current.value?.chat ?? null),
    ensureSession: store.ensureSession,
    clearCurrent: store.clearCurrent,
    toggle: store.toggle,
  };
}
