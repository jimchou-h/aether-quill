<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import type { components } from '@aether-quill/shared-types';
import { apiClient } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';

type LlmChatProviderId = components['schemas']['LlmChatProviderId'];
type UserGenerationPreferences = components['schemas']['UserGenerationPreferences'];

const GENERATION_MODEL_ID_MAX_LENGTH = 128;

const PROVIDER_OPTIONS: Array<{ value: LlmChatProviderId; label: string }> = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'siliconflow', label: 'SiliconFlow' },
];

const MODEL_SUGGESTIONS_BY_PROVIDER: Record<LlmChatProviderId, readonly string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  siliconflow: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
};

const writingProvider = shallowRef<LlmChatProviderId>('deepseek');
const writingModel = shallowRef('');
const writingTemperature = shallowRef<number | null>(null);
const useCustomWritingTemperature = shallowRef(false);

const utilityProvider = shallowRef<LlmChatProviderId>('deepseek');
const utilityModel = shallowRef('');
const utilityTemperature = shallowRef(0.7);

const saved = shallowRef<UserGenerationPreferences | null>(null);
const loading = shallowRef(false);
const saving = shallowRef(false);
const errorMessage = shallowRef('');
const message = shallowRef('');

function normalizeModelInput(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, GENERATION_MODEL_ID_MAX_LENGTH);
}

function modelPayloadFromInput(value: string): string | null {
  const trimmed = normalizeModelInput(value);
  return trimmed.length > 0 ? trimmed : null;
}

function applyFromPreferences(prefs: UserGenerationPreferences) {
  writingProvider.value = prefs.writing.provider;
  writingModel.value = normalizeModelInput(prefs.writing.model);
  useCustomWritingTemperature.value = typeof prefs.writing.temperature === 'number';
  writingTemperature.value =
    typeof prefs.writing.temperature === 'number' ? prefs.writing.temperature : null;

  utilityProvider.value = prefs.utility.provider;
  utilityModel.value = normalizeModelInput(prefs.utility.model);
  utilityTemperature.value =
    typeof prefs.utility.temperature === 'number' ? prefs.utility.temperature : 0.7;

  saved.value = prefs;
}

const writingModelSuggestions = computed(
  () => MODEL_SUGGESTIONS_BY_PROVIDER[writingProvider.value] ?? []
);
const utilityModelSuggestions = computed(
  () => MODEL_SUGGESTIONS_BY_PROVIDER[utilityProvider.value] ?? []
);

const isDirty = computed(() => {
  if (!saved.value) {
    return false;
  }
  const writingTemp = useCustomWritingTemperature.value
    ? (writingTemperature.value ?? 0.9)
    : null;
  return (
    writingProvider.value !== saved.value.writing.provider ||
    modelPayloadFromInput(writingModel.value) !== saved.value.writing.model ||
    writingTemp !== saved.value.writing.temperature ||
    utilityProvider.value !== saved.value.utility.provider ||
    modelPayloadFromInput(utilityModel.value) !== saved.value.utility.model ||
    utilityTemperature.value !== saved.value.utility.temperature
  );
});

async function load() {
  loading.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const prefs = await apiClient.getGenerationPreferences();
    applyFromPreferences(prefs);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载全局模型设置失败');
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const prefs = await apiClient.updateGenerationPreferences({
      writing: {
        provider: writingProvider.value,
        model: modelPayloadFromInput(writingModel.value),
        temperature: useCustomWritingTemperature.value
          ? (writingTemperature.value ?? 0.9)
          : null,
      },
      utility: {
        provider: utilityProvider.value,
        model: modelPayloadFromInput(utilityModel.value),
        temperature: utilityTemperature.value,
      },
    });
    applyFromPreferences(prefs);
    message.value = presentSuccess('全局模型设置已保存');
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存全局模型设置失败');
  } finally {
    saving.value = false;
  }
}

function onToggleWritingTemperature(enabled: boolean) {
  useCustomWritingTemperature.value = enabled;
  if (enabled && writingTemperature.value === null) {
    writingTemperature.value = 0.9;
  }
  if (!enabled) {
    writingTemperature.value = null;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="panel">
    <h2 class="panel-title">全局模型设置</h2>
    <p class="field-hint">
      写作任务与常规（工具）任务可分别选择厂商与模型；密钥仍由服务端环境变量配置，此处不填写
      API Key。未填模型时使用对应厂商的环境默认模型。
    </p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>
    <p v-if="loading" class="message">正在加载全局模型设置...</p>

    <template v-if="!loading">
      <h3 class="section-title">写作档</h3>
      <div class="row">
        <label class="field-label" for="aq-global-writing-provider">写作厂商</label>
        <select
          id="aq-global-writing-provider"
          v-model="writingProvider"
          class="field-input"
          :disabled="saving"
        >
          <option v-for="opt in PROVIDER_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="row">
        <label class="field-label" for="aq-global-writing-model">写作模型</label>
        <input
          id="aq-global-writing-model"
          v-model="writingModel"
          class="field-input field-input-wide"
          type="text"
          list="aq-global-writing-model-suggestions"
          maxlength="128"
          placeholder="留空 = 环境默认"
          :disabled="saving"
        />
      </div>
      <datalist id="aq-global-writing-model-suggestions">
        <option v-for="modelId in writingModelSuggestions" :key="modelId" :value="modelId" />
      </datalist>
      <p class="field-hint inline-hint">用于续写、优化 draft、精修改写等进正文任务。</p>

      <div class="toggle-row">
        <label class="toggle-label">
          <input
            type="checkbox"
            class="toggle-checkbox"
            :checked="useCustomWritingTemperature"
            :disabled="saving"
            @change="onToggleWritingTemperature(($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-text">自定义写作温度</span>
        </label>
      </div>
      <div v-if="useCustomWritingTemperature" class="row">
        <label class="field-label" for="aq-global-writing-temperature">写作温度</label>
        <input
          id="aq-global-writing-temperature"
          v-model.number="writingTemperature"
          class="field-input"
          type="number"
          min="0"
          max="2"
          step="0.05"
          :disabled="saving"
        />
      </div>
      <p class="field-hint inline-hint">
        未勾选时使用环境变量 PROVIDER_TEMPERATURE_WRITING（默认约 0.9）。
      </p>

      <h3 class="section-title">常规档</h3>
      <div class="row">
        <label class="field-label" for="aq-global-utility-provider">常规厂商</label>
        <select
          id="aq-global-utility-provider"
          v-model="utilityProvider"
          class="field-input"
          :disabled="saving"
        >
          <option v-for="opt in PROVIDER_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="row">
        <label class="field-label" for="aq-global-utility-model">常规模型</label>
        <input
          id="aq-global-utility-model"
          v-model="utilityModel"
          class="field-input field-input-wide"
          type="text"
          list="aq-global-utility-model-suggestions"
          maxlength="128"
          placeholder="留空 = 环境默认"
          :disabled="saving"
        />
      </div>
      <datalist id="aq-global-utility-model-suggestions">
        <option v-for="modelId in utilityModelSuggestions" :key="modelId" :value="modelId" />
      </datalist>
      <p class="field-hint inline-hint">用于大纲、验收、扫描、摘要等工具类任务。</p>

      <div class="row">
        <label class="field-label" for="aq-global-utility-temperature">常规温度</label>
        <input
          id="aq-global-utility-temperature"
          v-model.number="utilityTemperature"
          class="field-input"
          type="number"
          min="0"
          max="2"
          step="0.05"
          :disabled="saving"
        />
      </div>
      <p class="field-hint inline-hint">范围 0~2；默认 0.7。</p>

      <div class="actions">
        <button
          class="primary-button"
          type="button"
          :disabled="saving || !isDirty"
          @click="handleSave"
        >
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  padding: 1.25rem 1.5rem;
  background: var(--aq-surface);
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-md, 8px);
}

.panel-title {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 700;
}

.section-title {
  margin: 1.25rem 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
}

.field-hint {
  margin: 0 0 1rem;
  color: var(--aq-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.inline-hint {
  margin-top: -0.35rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.field-label {
  flex: 0 0 8.5rem;
  font-size: 0.875rem;
  color: var(--aq-text);
}

.field-input {
  width: 12rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--aq-border);
  border-radius: 6px;
  background: var(--aq-bg, #fff);
  color: var(--aq-text);
}

.field-input-wide {
  width: min(28rem, 100%);
}

.toggle-row {
  margin: 0.5rem 0 0.75rem;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.toggle-checkbox {
  margin: 0;
}

.toggle-text {
  font-size: 0.875rem;
}

.actions {
  margin-top: 1.25rem;
}

.primary-button {
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 6px;
  background: var(--aq-primary);
  color: var(--aq-text-inverse, #fff);
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.message {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
}

.message-error {
  color: #b42318;
}

.message-ok {
  color: #027a48;
}
</style>
