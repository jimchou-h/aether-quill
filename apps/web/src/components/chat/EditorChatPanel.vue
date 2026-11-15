<template>
  <Teleport to="body">
    <div class="editor-chat-root">
      <button
        v-if="!open"
        ref="triggerEl"
        type="button"
        class="editor-chat-trigger aq-btn aq-btn-ghost"
        data-testid="editor-chat-trigger"
        @click="togglePanel"
      >
        编辑对话
      </button>

      <section
        v-else
        class="editor-chat-panel"
        data-testid="editor-chat-panel"
        aria-label="项目编辑对话"
      >
        <header class="editor-chat-header">
          <span class="editor-chat-title">编辑对话</span>
          <span v-if="anchorChapterNo" class="editor-chat-anchor">
            当前讨论：第 {{ anchorChapterNo }} 章
          </span>
          <button
            type="button"
            class="editor-chat-clear"
            data-testid="editor-chat-clear"
            :disabled="messages.length === 0"
            @click="clearCurrent"
          >
            清空
          </button>
          <button
            type="button"
            class="editor-chat-close"
            data-testid="editor-chat-close"
            @click="togglePanel"
          >
            收起
          </button>
        </header>

        <div ref="listEl" class="editor-chat-messages">
          <p v-if="messages.length === 0" class="editor-chat-empty">
            就某一章提出优化问题，例如「第 7 章有什么优化想法」。回答只作建议，不会自动改稿。
            <span class="editor-chat-memory-note">
              对话只保存在当前浏览器：换设备或清除浏览器数据后不会恢复，「清空」会同时删除本机记录。
            </span>
          </p>
          <article
            v-for="(message, index) in messages"
            :key="index"
            class="editor-chat-message"
            :class="`editor-chat-message--${message.role}`"
          >
            <div
              v-if="message.role === 'assistant'"
              class="editor-chat-message-body editor-chat-message-body--rich"
            >
              <MarkdownContent :source="message.content" :throttle-ms="streaming ? 200 : 0">
                <template #empty><span class="editor-chat-pending">…</span></template>
              </MarkdownContent>
            </div>
            <div v-else class="editor-chat-message-body">{{ message.content }}</div>
            <button
              v-if="message.role === 'assistant' && message.content"
              type="button"
              class="editor-chat-copy"
              data-testid="editor-chat-copy"
              @click="copyMessage(message.content, index)"
            >
              {{ copiedIndex === index ? '已复制' : '复制' }}
            </button>
          </article>
        </div>

        <p v-if="errorText" class="editor-chat-error" role="alert">
          {{ errorText }}
        </p>

        <footer class="editor-chat-composer">
          <textarea
            v-model="draft"
            class="editor-chat-input"
            data-testid="editor-chat-input"
            rows="2"
            placeholder="例如：第 7 章有什么优化想法"
            :disabled="streaming"
            @keydown.enter.exact.prevent="submit"
          ></textarea>
          <button
            type="button"
            class="editor-chat-send aq-btn"
            data-testid="editor-chat-send"
            :disabled="!draft.trim() || streaming"
            @click="submit"
          >
            {{ streaming ? '回答中…' : '发送' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import MarkdownContent from '../common/MarkdownContent.vue';
import { useAuthStore } from '../../stores/auth';
import { useEditorChatStore } from '../../composables/useEditorChatStore';

const props = defineProps<{ projectId: string }>();

const auth = useAuthStore();
const { open, chat, ensureSession, clearCurrent, toggle } = useEditorChatStore();
const draft = ref('');
const copiedIndex = ref(-1);
const listEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLElement | null>(null);

const messages = computed(() => chat.value?.messages.value ?? []);
const streaming = computed(() => chat.value?.streaming.value === true);
const errorText = computed(() => chat.value?.error.value ?? '');
const anchorChapterNo = computed(() => chat.value?.currentChapterNo.value ?? null);

// 刷新后 userId 要等 me 接口返回；身份到位才能按 userId+projectId 恢复会话
watch(
  [() => props.projectId, () => auth.user?.userId ?? ''],
  ([projectId, userId]) => {
    void ensureSession({ projectId, userId });
  },
  { immediate: true }
);

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight;
    }
  }
);

async function togglePanel() {
  const willOpen = !open.value;
  toggle();
  if (willOpen) {
    return;
  }
  // 面板与触发按钮是 v-if 兄弟：收起后按钮是新渲染的节点，焦点必须显式交还
  await nextTick();
  triggerEl.value?.focus();
}

async function submit() {
  if (!chat.value) {
    return;
  }
  const question = draft.value;
  draft.value = '';
  await chat.value.send(question);
}

async function copyMessage(content: string, index: number) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      const area = document.createElement('textarea');
      area.value = content;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    copiedIndex.value = index;
    window.setTimeout(() => {
      copiedIndex.value = -1;
    }, 1500);
  } catch {
    // 剪贴板不可用时保持静默；消息文本可选中复制兜底
  }
}
</script>

<style scoped>
.editor-chat-root {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  /* 高于 antd 弹窗默认层级（1000）：全屏按场成稿弹窗打开时仍能显示并点击 */
  z-index: 1300;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--aq-space-xs);
}

.editor-chat-trigger {
  border: 2px solid var(--aq-border);
  border-radius: var(--aq-radius-sm);
  background: var(--aq-surface);
  color: var(--aq-text-secondary);
  padding: 0.5rem 0.9rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}

.editor-chat-trigger:hover {
  color: var(--aq-primary);
  border-color: var(--aq-primary);
}

.editor-chat-panel {
  width: min(24rem, calc(100vw - 2.5rem));
  max-height: min(32rem, calc(100vh - 8rem));
  display: flex;
  flex-direction: column;
  background: var(--aq-surface);
  border: 2px solid var(--aq-border);
  border-radius: var(--aq-radius-sm);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}

.editor-chat-header {
  display: flex;
  align-items: center;
  gap: var(--aq-space-sm);
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid var(--aq-border);
}

.editor-chat-title {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--aq-text);
}

.editor-chat-anchor {
  flex: 1;
  font-size: 0.75rem;
  color: var(--aq-text-secondary);
}

.editor-chat-clear,
.editor-chat-close {
  border: none;
  background: transparent;
  color: var(--aq-text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.editor-chat-clear:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.editor-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.6rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: var(--aq-space-sm);
}

.editor-chat-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--aq-text-secondary);
}

.editor-chat-memory-note {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: var(--aq-text-secondary);
}

.editor-chat-message {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}

.editor-chat-message--assistant {
  align-items: flex-end;
}

.editor-chat-message-body--rich {
  white-space: normal;
  min-width: 3rem;
}

.editor-chat-message-body--rich :deep(.markdown-content) {
  color: inherit;
  line-height: 1.55;
}

.editor-chat-message-body--rich :deep(.markdown-content h1),
.editor-chat-message-body--rich :deep(.markdown-content h2),
.editor-chat-message-body--rich :deep(.markdown-content h3),
.editor-chat-message-body--rich :deep(.markdown-content h4) {
  margin: 0.4rem 0 0.3rem;
  font-size: 0.9rem;
}

.editor-chat-message-body--rich :deep(.markdown-content p),
.editor-chat-message-body--rich :deep(.markdown-content ul),
.editor-chat-message-body--rich :deep(.markdown-content ol) {
  font-size: inherit;
}

.editor-chat-message-body--rich :deep(.markdown-content pre) {
  max-width: 100%;
  font-size: 0.8rem;
}

.editor-chat-pending {
  color: var(--aq-text-secondary);
}

.editor-chat-message-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  line-height: 1.55;
  padding: 0.45rem 0.65rem;
  border-radius: var(--aq-radius-xs);
  background: var(--aq-bg-subtle);
  color: var(--aq-text);
  max-width: 100%;
}

.editor-chat-copy {
  border: none;
  background: transparent;
  color: var(--aq-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}

.editor-chat-copy:hover {
  color: var(--aq-primary);
}

.editor-chat-error {
  margin: 0;
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
  color: var(--aq-danger, #b42318);
}

.editor-chat-composer {
  display: flex;
  gap: var(--aq-space-xs);
  padding: 0.6rem 0.8rem;
  border-top: 1px solid var(--aq-border);
}

.editor-chat-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-xs);
  padding: 0.4rem 0.55rem;
  font-size: 0.85rem;
  font-family: inherit;
  background: var(--aq-bg);
  color: var(--aq-text);
}

.editor-chat-send {
  align-self: flex-end;
  border: 2px solid var(--aq-primary);
  border-radius: var(--aq-radius-xs);
  background: var(--aq-primary);
  color: var(--aq-text-inverse);
  padding: 0.35rem 0.8rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.editor-chat-send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
