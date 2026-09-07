<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { apiClient, type ProtagonistUnlockRule, type ProjectSettings } from '../../services/api';
import { presentErrorFromCaught, presentSuccess } from '../../utils/pageFeedback';
import {
  buildBasePipelineEnabledModules,
  selectionFromProjectSettings,
} from '../../utils/pipelineModuleSelection';

const props = defineProps<{
  projectId: string;
}>();

const sensoryEnabled = ref(true);
const skipOutlineReview = ref(false);
const skipCharacterOutlineReview = ref(false);
const skipCharacterTraitsOutlineReview = ref(false);
const characterAdjustmentEnabled = ref(false);
const characterTraitsEnabled = ref(true);
const complianceRulesFixMode = ref<'auto' | 'semi' | 'manual'>('semi');
const homogenizationEnabled = ref(false);
const homogenizationPriorCount = ref(3);
const protagonistRules = ref<ProtagonistUnlockRule[]>([]);
const loading = ref(false);
const saving = ref(false);

function addProtagonistRule() {
  protagonistRules.value.push({
    abilityKey: '',
    descriptionForPrompt: '',
  });
}

function removeProtagonistRule(index: number) {
  protagonistRules.value.splice(index, 1);
}

async function loadSettings() {
  loading.value = true;
  try {
    const settings = await apiClient.getSettings(props.projectId);
    applySettings(settings);
  } catch (error) {
    presentErrorFromCaught(error, '加载创作精修设置失败');
  } finally {
    loading.value = false;
  }
}

function applySettings(settings: ProjectSettings & {
  pipelineSkipSensoryOutlineReview?: boolean;
  pipelineSkipCharacterOutlineReview?: boolean;
  pipelineSkipCharacterTraitsOutlineReview?: boolean;
  pipelineCharacterAdjustmentEnabled?: boolean;
  pipelineCharacterTraitsEnabled?: boolean;
  complianceRulesFixMode?: typeof complianceRulesFixMode.value;
  pipelineRulesFixMode?: typeof complianceRulesFixMode.value;
  pipelineHomogenizationEnabled?: boolean;
  pipelineHomogenizationPriorChapterCount?: number;
  protagonistProgressRules?: ProtagonistUnlockRule[];
  pipelineEnabledModules?: number[];
}) {
  const selection = selectionFromProjectSettings(settings);
  sensoryEnabled.value = selection.sensory;
  characterAdjustmentEnabled.value = selection.characterAdjustment;
  characterTraitsEnabled.value = selection.characterTraits;
  homogenizationEnabled.value = selection.homogenization;
  skipOutlineReview.value = settings.pipelineSkipSensoryOutlineReview ?? false;
  skipCharacterOutlineReview.value = settings.pipelineSkipCharacterOutlineReview ?? false;
  skipCharacterTraitsOutlineReview.value =
    settings.pipelineSkipCharacterTraitsOutlineReview ?? false;
  complianceRulesFixMode.value =
    settings.complianceRulesFixMode ?? settings.pipelineRulesFixMode ?? 'semi';
  homogenizationPriorCount.value = settings.pipelineHomogenizationPriorChapterCount ?? 3;
  protagonistRules.value = (settings.protagonistProgressRules ?? []).map((r) => ({ ...r }));
}

async function saveSettings() {
  saving.value = true;
  try {
    const pipelineEnabledModules = buildBasePipelineEnabledModules({
      characterAdjustment: characterAdjustmentEnabled.value,
      characterTraits: characterTraitsEnabled.value,
      sensory: sensoryEnabled.value,
    });
    await apiClient.updateSettings(props.projectId, {
      pipelineEnabledModules,
      pipelineSkipSensoryOutlineReview: skipOutlineReview.value,
      pipelineSkipCharacterOutlineReview: skipCharacterOutlineReview.value,
      pipelineSkipCharacterTraitsOutlineReview: skipCharacterTraitsOutlineReview.value,
      pipelineCharacterAdjustmentEnabled: characterAdjustmentEnabled.value,
      pipelineCharacterTraitsEnabled: characterTraitsEnabled.value,
      complianceRulesFixMode: complianceRulesFixMode.value,
      pipelineHomogenizationEnabled: homogenizationEnabled.value,
      pipelineHomogenizationPriorChapterCount: homogenizationPriorCount.value,
      protagonistProgressRules: protagonistRules.value.filter(
        (r) => r.abilityKey.trim() && r.descriptionForPrompt.trim()
      ),
    } as Parameters<typeof apiClient.updateSettings>[1]);
    presentSuccess('创作精修设置已保存');
  } catch (error) {
    presentErrorFromCaught(error, '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <section class="panel">
    <h3 class="panel-title">创作精修流水线</h3>
    <p class="field-hint">
      配置项目默认精修模块与大纲 gate；单次启动时仍可在弹窗内按章覆盖勾选。硬规则请使用「终稿合规检验」。
    </p>

    <p v-if="loading" class="loading-text">加载中…</p>
    <template v-else>
      <div class="module-defaults">
        <h4 class="sub-title">默认精修模块</h4>
        <div class="toggle-row">
          <label class="toggle-label">
            <input v-model="characterAdjustmentEnabled" class="toggle-checkbox" type="checkbox" />
            <span class="toggle-text">角色对白调整</span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label">
            <input v-model="characterTraitsEnabled" class="toggle-checkbox" type="checkbox" />
            <span class="toggle-text">角色特征润色</span>
          </label>
        </div>
        <div class="toggle-row">
          <label class="toggle-label">
            <input v-model="sensoryEnabled" class="toggle-checkbox" type="checkbox" />
            <span class="toggle-text">感官优化</span>
          </label>
        </div>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="skipCharacterOutlineReview" class="toggle-checkbox" type="checkbox" />
          <span class="toggle-text">默认跳过角色调整大纲审核</span>
        </label>
      </div>

      <div v-if="characterTraitsEnabled" class="toggle-row">
        <label class="toggle-label">
          <input
            v-model="skipCharacterTraitsOutlineReview"
            class="toggle-checkbox"
            type="checkbox"
          />
          <span class="toggle-text">默认跳过特征润色大纲审核</span>
        </label>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="skipOutlineReview" class="toggle-checkbox" type="checkbox" />
          <span class="toggle-text">默认跳过感官大纲人工审核</span>
        </label>
      </div>

      <div class="row">
        <label class="field-label" for="compliance-rules-fix-mode">终稿合规修复模式</label>
        <select id="compliance-rules-fix-mode" v-model="complianceRulesFixMode" class="field-select">
          <option value="auto">全自动</option>
          <option value="semi">半自动（推荐）</option>
          <option value="manual">全人工</option>
        </select>
      </div>

      <div class="toggle-row">
        <label class="toggle-label">
          <input v-model="homogenizationEnabled" class="toggle-checkbox" type="checkbox" />
          <span class="toggle-text">默认启用同质化检测（模块四）</span>
        </label>
      </div>

      <div v-if="homogenizationEnabled" class="row">
        <label class="field-label" for="homo-prior-count">同质化参考前 N 章</label>
        <input
          id="homo-prior-count"
          v-model.number="homogenizationPriorCount"
          class="field-input"
          type="number"
          min="1"
          max="10"
        />
      </div>

      <div class="rules-block">
        <div class="rules-block-header">
          <h4 class="sub-title">主角进度规则（注入模块一）</h4>
          <button class="secondary-button" type="button" @click="addProtagonistRule">添加规则</button>
        </div>
        <p v-if="protagonistRules.length === 0" class="empty-hint">暂无规则，可按章节解锁能力/外形描述。</p>
        <div v-for="(rule, index) in protagonistRules" :key="index" class="rule-card">
          <input v-model="rule.abilityKey" class="field-input wide" placeholder="能力键（如：飞行）" />
          <input
            v-model.number="rule.unlockAtChapter"
            class="field-input narrow"
            type="number"
            placeholder="解锁章节"
            min="1"
          />
          <input
            v-model="rule.unlockAfterCondition"
            class="field-input wide"
            placeholder="解锁条件（可选，自由文本）"
          />
          <input
            v-model="rule.descriptionForPrompt"
            class="field-input full"
            placeholder="注入 Prompt 的描述"
          />
          <button class="text-button" type="button" @click="removeProtagonistRule(index)">删除</button>
        </div>
      </div>

      <div class="action-bar">
        <button class="primary-button" type="button" :disabled="saving" @click="saveSettings">
          {{ saving ? '保存中…' : '保存创作精修设置' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-title {
  margin: 0 0 0.35rem;
  font-size: 1rem;
}

.field-hint {
  color: #9ca3af;
  font-size: 0.8rem;
  margin: 0 0 0.75rem;
}

.loading-text {
  margin: 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.module-defaults {
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #f3f4f6;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.field-label {
  min-width: 10rem;
  font-size: 0.9rem;
  color: #374151;
}

.field-input,
.field-select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #111827;
  background: #fff;
}

.field-input {
  width: 8rem;
}

.field-input.wide {
  width: 100%;
}

.field-input.narrow {
  width: 6rem;
}

.field-input.full {
  grid-column: 1 / -2;
  width: 100%;
}

.field-select {
  min-width: 12rem;
}

.toggle-row {
  display: flex;
  align-items: center;
  margin: 0.35rem 0 0.5rem;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
}

.toggle-checkbox {
  width: 15px;
  height: 15px;
  accent-color: #111827;
}

.toggle-text {
  font-size: 0.9rem;
  color: #374151;
}

.rules-block {
  margin: 1rem 0 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #f3f4f6;
}

.rules-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.sub-title {
  margin: 0;
  font-size: 0.92rem;
  color: #111827;
}

.empty-hint {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  color: #9ca3af;
}

.rule-card {
  display: grid;
  grid-template-columns: 1fr 6rem 1fr auto;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  padding: 0.65rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.text-button {
  border: none;
  background: transparent;
  color: #2563eb;
  font-size: 0.82rem;
  cursor: pointer;
  align-self: center;
}

.text-button:hover {
  text-decoration: underline;
}

.action-bar {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button {
  background: #2563eb;
  color: #fff;
  border: none;
}

.secondary-button {
  background: #fff;
  color: #111827;
  border: 1px solid #d1d5db;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .rule-card {
    grid-template-columns: 1fr;
  }

  .field-input.full {
    grid-column: auto;
  }
}
</style>
