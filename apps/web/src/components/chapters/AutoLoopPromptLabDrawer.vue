<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { apiClient, type AutoLoopPromptLabCall } from '../../services/api';
import { useTaskPromptConfigStore } from '../../stores/taskPromptConfig';
import { usePromptConfigStore } from '../../stores/promptConfig';
import { confirmAction } from '../../composables/useAppConfirm';
import { presentErrorFromCaught } from '../../utils/pageFeedback';
import {
  applyPromptLabSuggestionToLayer,
  type PromptLabLayer,
} from '../../utils/autoLoopPromptLab';
import {
  AUTO_LOOP_PROMPT_LAB_CHAT_HINT,
  AUTO_LOOP_PROMPT_LAB_PUBLISH_HINT,
  AUTO_LOOP_PROMPT_LAB_SYSTEM_PUBLISH_HINT,
  AUTO_LOOP_PROMPT_LAB_USER_PROMPT_HINT,
} from '../../utils/autoLoopPromptLabCopy';

const props = defineProps<{
  open: boolean;
  projectId: string;
  chapterNo: number;
  call: AutoLoopPromptLabCall | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const taskStore = useTaskPromptConfigStore();
const systemStore = usePromptConfigStore();
const projectSystemText = shallowRef('');
const diagnosePromptText = shallowRef('');
const replayOutput = shallowRef('');
const chatInput = shallowRef('');
const chatLog = shallowRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
const pendingSuggestion = shallowRef<{
  suggestedLayer: PromptLabLayer;
  suggestedText: string;
  rationale: string;
} | null>(null);
const busy = shallowRef(false);
const errorMessage = shallowRef('');
const editorLayer = shallowRef<PromptLabLayer>('diagnose');

const title = computed(() => '调诊断 Prompt');

watch(
  () => [props.open, props.call?.id] as const,
  async ([open]) => {
    if (!open || !props.call) {
      return;
    }
    diagnosePromptText.value = props.call.taskPromptText;
    replayOutput.value = '';
    chatInput.value = '';
    chatLog.value = [];
    pendingSuggestion.value = null;
    errorMessage.value = '';
    await Promise.all([
      taskStore.loadList(props.projectId),
      systemStore.loadConfig(props.projectId),
    ]);
    projectSystemText.value = systemStore.draftText;
  },
  { immediate: true }
);

async function replay() {
  if (!props.call) {
    return;
  }
  busy.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.replayAutoLoopPromptLab(props.projectId, props.chapterNo, {
      callId: props.call.id,
      taskPromptText: diagnosePromptText.value,
      projectSystemPromptText: projectSystemText.value,
    });
    replayOutput.value = result.output;
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '重跑失败');
  } finally {
    busy.value = false;
  }
}

async function advise() {
  if (!props.call || !chatInput.value.trim()) {
    return;
  }
  const message = chatInput.value.trim();
  busy.value = true;
  errorMessage.value = '';
  try {
    const result = await apiClient.adviseAutoLoopPromptLab(props.projectId, props.chapterNo, {
      callId: props.call.id,
      taskPromptText: diagnosePromptText.value,
      projectSystemText: projectSystemText.value,
      message,
      latestReplayOutput: replayOutput.value || undefined,
      history: chatLog.value,
    });
    pendingSuggestion.value = {
      suggestedLayer: result.suggestedLayer === 'project_system' ? 'project_system' : 'diagnose',
      suggestedText: result.suggestedText,
      rationale: result.rationale?.trim() || '已给出建议，请点选写入的层。',
    };
    chatLog.value = [
      ...chatLog.value,
      { role: 'user', content: message },
      { role: 'assistant', content: pendingSuggestion.value.rationale },
    ];
    chatInput.value = '';
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '对话调优失败');
  } finally {
    busy.value = false;
  }
}

function writeSuggestion(writeTo: PromptLabLayer) {
  if (!pendingSuggestion.value) {
    return;
  }
  const next = applyPromptLabSuggestionToLayer(
    { projectSystem: projectSystemText.value, diagnose: diagnosePromptText.value },
    pendingSuggestion.value,
    writeTo
  );
  projectSystemText.value = next.projectSystem;
  diagnosePromptText.value = next.diagnose;
}

async function saveDiagnoseDraft() {
  if (!props.call) {
    return;
  }
  try {
    taskStore.setDraft(props.call.templateKey, diagnosePromptText.value);
    await taskStore.saveDraft(props.projectId, props.call.templateKey);
    if (taskStore.errorMessage) {
      errorMessage.value = taskStore.errorMessage;
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存草稿失败');
  }
}

async function publishDiagnose() {
  if (!props.call) {
    return;
  }
  const confirmed = await confirmAction({
    title: '发布诊断 Prompt',
    content: AUTO_LOOP_PROMPT_LAB_PUBLISH_HINT,
    okText: '确认发布',
    zIndex: 1200,
  });
  if (!confirmed) {
    return;
  }
  try {
    taskStore.setDraft(props.call.templateKey, diagnosePromptText.value);
    await taskStore.saveDraft(props.projectId, props.call.templateKey);
    if (taskStore.errorMessage) {
      errorMessage.value = taskStore.errorMessage;
      return;
    }
    await taskStore.publish(props.projectId, props.call.templateKey);
    if (taskStore.errorMessage) {
      errorMessage.value = taskStore.errorMessage;
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '发布失败');
  }
}

async function saveSystemDraft() {
  if (!projectSystemText.value.trim()) {
    errorMessage.value = '系统提示词不能为空';
    return;
  }
  try {
    systemStore.draftText = projectSystemText.value;
    await systemStore.saveDraft(props.projectId);
    if (systemStore.errorMessage) {
      errorMessage.value = systemStore.errorMessage;
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存草稿失败');
  }
}

async function publishSystem() {
  if (!projectSystemText.value.trim()) {
    errorMessage.value = '系统提示词不能为空';
    return;
  }
  const confirmed = await confirmAction({
    title: '发布项目 system',
    content: AUTO_LOOP_PROMPT_LAB_SYSTEM_PUBLISH_HINT,
    okText: '确认发布',
    zIndex: 1200,
  });
  if (!confirmed) {
    return;
  }
  try {
    systemStore.draftText = projectSystemText.value;
    await systemStore.saveDraft(props.projectId);
    if (systemStore.errorMessage) {
      errorMessage.value = systemStore.errorMessage;
      return;
    }
    await systemStore.publish(props.projectId);
    if (systemStore.errorMessage) {
      errorMessage.value = systemStore.errorMessage;
    }
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '发布失败');
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && call" class="lab-backdrop" @click.self="emit('close')">
      <section class="lab-drawer" role="dialog" aria-modal="true" :aria-label="title">
        <header class="lab-head">
          <h3>{{ title }}</h3>
          <button class="lab-close" type="button" @click="emit('close')">关闭</button>
        </header>
        <div class="lab-body">
          <details class="lab-fold">
            <summary>{{ AUTO_LOOP_PROMPT_LAB_USER_PROMPT_HINT }}</summary>
            <pre class="lab-frozen">{{ call.userPrompt }}</pre>
          </details>
          <div class="lab-tabs" role="tablist" aria-label="可编辑层">
            <button
              class="lab-tab"
              type="button"
              role="tab"
              :aria-selected="editorLayer === 'diagnose'"
              :class="{ 'lab-tab--active': editorLayer === 'diagnose' }"
              @click="editorLayer = 'diagnose'"
            >
              诊断 Prompt
            </button>
            <button
              class="lab-tab"
              type="button"
              role="tab"
              :aria-selected="editorLayer === 'project_system'"
              :class="{ 'lab-tab--active': editorLayer === 'project_system' }"
              @click="editorLayer = 'project_system'"
            >
              项目 system
            </button>
          </div>
          <div v-show="editorLayer === 'project_system'" class="lab-layer">
            <textarea v-model="projectSystemText" class="lab-editor" :disabled="busy" />
            <div class="lab-actions">
              <button
                class="secondary-button"
                type="button"
                :disabled="busy"
                @click="saveSystemDraft"
              >
                保存草稿
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="busy"
                @click="publishSystem"
              >
                发布
              </button>
            </div>
            <p class="lab-hint">{{ AUTO_LOOP_PROMPT_LAB_SYSTEM_PUBLISH_HINT }}</p>
          </div>
          <div v-show="editorLayer === 'diagnose'" class="lab-layer">
            <textarea v-model="diagnosePromptText" class="lab-editor" :disabled="busy" />
            <div class="lab-actions">
              <button
                class="secondary-button"
                type="button"
                :disabled="busy"
                @click="saveDiagnoseDraft"
              >
                保存草稿
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="busy"
                @click="publishDiagnose"
              >
                发布
              </button>
            </div>
            <p class="lab-hint">{{ AUTO_LOOP_PROMPT_LAB_PUBLISH_HINT }}</p>
          </div>
          <div class="lab-compare">
            <div>
              <h4>原诊断输出</h4>
              <pre class="lab-output">{{ call.output }}</pre>
            </div>
            <div>
              <h4>重跑对照</h4>
              <pre class="lab-output">{{ replayOutput || '尚未重跑' }}</pre>
            </div>
          </div>
          <ul class="lab-chat">
            <li v-for="(turn, index) in chatLog" :key="index">
              <strong>{{ turn.role === 'user' ? '你' : '助手' }}</strong>
              {{ turn.content }}
            </li>
          </ul>
        </div>
        <footer class="lab-dock">
          <p class="lab-hint">{{ AUTO_LOOP_PROMPT_LAB_CHAT_HINT }}</p>
          <p v-if="pendingSuggestion" class="lab-hint">
            助手更像改{{
              pendingSuggestion.suggestedLayer === 'project_system' ? '项目 system' : '诊断 Prompt'
            }}。点写入才会进编辑器。
          </p>
          <div v-if="pendingSuggestion" class="lab-actions">
            <button
              class="primary-button"
              type="button"
              :class="{ 'lab-recommended': pendingSuggestion.suggestedLayer === 'project_system' }"
              :disabled="busy"
              @click="writeSuggestion('project_system')"
            >
              写入项目 system
            </button>
            <button
              class="primary-button"
              type="button"
              :class="{ 'lab-recommended': pendingSuggestion.suggestedLayer === 'diagnose' }"
              :disabled="busy"
              @click="writeSuggestion('diagnose')"
            >
              写入诊断 Prompt
            </button>
          </div>
          <textarea
            v-model="chatInput"
            class="lab-chat-input"
            :disabled="busy"
            placeholder="例如：别再抓语气，要抓动作节奏"
          />
          <div class="lab-actions">
            <button class="primary-button" type="button" :disabled="busy" @click="replay">
              用这次输入重跑
            </button>
            <button class="secondary-button" type="button" :disabled="busy" @click="advise">
              按评点给建议
            </button>
          </div>
          <p v-if="errorMessage" class="lab-error">{{ errorMessage }}</p>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.lab-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: flex-end;
}
.lab-drawer {
  width: min(480px, 100%);
  height: 100%;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.lab-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}
.lab-head h3 {
  margin: 0;
  font-size: 16px;
}
.lab-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lab-dock {
  flex: 0 0 auto;
  padding: 12px 16px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fff;
}
.lab-close,
.lab-actions button,
.secondary-button,
.primary-button,
.lab-tab {
  cursor: pointer;
}
.lab-hint {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}
.lab-fold summary {
  cursor: pointer;
  color: #4b5563;
  font-size: 12px;
}
.lab-tabs {
  display: flex;
  padding: 3px;
  border-radius: 8px;
  background: #f3f4f6;
  width: fit-content;
}
.lab-tab {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 6px;
  color: #4b5563;
  transition:
    background-color 180ms ease,
    color 180ms ease;
}
.lab-tab--active {
  background: #fff;
  color: #1d4ed8;
  font-weight: 600;
}
.lab-layer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lab-frozen,
.lab-output,
.lab-editor,
.lab-chat-input {
  width: 100%;
  min-height: 72px;
  margin: 0;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  box-sizing: border-box;
}
.lab-editor {
  min-height: 180px;
  font-family: inherit;
  resize: vertical;
}
.lab-chat-input {
  min-height: 64px;
  font-family: inherit;
  resize: none;
}
.lab-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.lab-compare h4 {
  margin: 0 0 4px;
  font-size: 13px;
}
.lab-output {
  max-height: 160px;
  overflow: auto;
}
.lab-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.lab-chat {
  margin: 0;
  padding-left: 16px;
  font-size: 13px;
}
.lab-error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}
.primary-button {
  background: #1d4ed8;
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 6px 10px;
  transition: background-color 180ms ease;
}
.primary-button:hover:not(:disabled) {
  background: #1e40af;
}
.secondary-button,
.lab-close {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 6px 10px;
}
.lab-recommended {
  box-shadow: 0 0 0 2px #93c5fd;
}
.lab-tab:focus-visible,
.primary-button:focus-visible,
.secondary-button:focus-visible,
.lab-close:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
</style>
