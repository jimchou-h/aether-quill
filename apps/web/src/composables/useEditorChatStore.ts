import { computed, ref, shallowRef } from 'vue';

import { apiClient } from '../services/api';
import { useEditorChat, type EditorChatApi } from './useEditorChat';

export interface EditorChatSession {
  projectId: string;
  chat: ReturnType<typeof useEditorChat>;
}

/**
 * 项目级编辑对话共享状态：悬浮入口与面板使用同一实例，
 * 收起与项目内路由切换不重置会话（浏览器持久化在 issue #48）。
 */
function createEditorChatStore(api: EditorChatApi) {
  const open = ref(false);
  const current = shallowRef<EditorChatSession | null>(null);

  function ensureProject(projectId: string) {
    if (current.value?.projectId === projectId) {
      return;
    }
    current.value = { projectId, chat: useEditorChat({ projectId, api }) };
  }

  function toggle() {
    open.value = !open.value;
  }

  return { open, current, ensureProject, toggle };
}

const store = createEditorChatStore(apiClient);

export function useEditorChatStore() {
  return {
    open: store.open,
    chat: computed(() => store.current.value?.chat ?? null),
    ensureProject: store.ensureProject,
    toggle: store.toggle,
  };
}
