import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient, type PromptTemplateItem, type PromptConfigVersionItem } from '../services/api';

export type ConfigStatus = 'draft' | 'published' | 'loading' | 'error';

export const usePromptConfigStore = defineStore('promptConfig', () => {
  const systemTemplateId = ref('');
  const draftText = ref('');
  const currentVersion = ref(0);
  const isPublished = ref(false);
  const versions = ref<PromptConfigVersionItem[]>([]);
  const status = ref<ConfigStatus>('loading');
  const saving = ref(false);
  const publishing = ref(false);
  const rollingBack = ref(false);
  const message = ref('');
  const errorMessage = ref('');

  const hasDraft = computed(() => draftText.value.length > 0);
  const hasVersions = computed(() => versions.value.length > 1);
  const publishedVersion = computed(() => versions.value.find((v) => v.isPublished) || null);
  const currentVersionInfo = computed(
    () => versions.value.find((v) => v.version === currentVersion.value) || null
  );
  const isDraftModified = computed(() => {
    const lastVersion = versions.value[versions.value.length - 1];
    return lastVersion ? draftText.value !== lastVersion.content : true;
  });

  async function loadConfig(projectId: string) {
    status.value = 'loading';
    errorMessage.value = '';
    try {
      const configResult = (await apiClient.promptConfig.get(projectId)) as any;
      const configData = configResult?.data ?? configResult;
      const templates: PromptTemplateItem[] = configData.templates || [];
      const systemTemplate = templates.find((t: PromptTemplateItem) => t.category === 'system');

      if (systemTemplate) {
        systemTemplateId.value = systemTemplate.id;
        draftText.value = systemTemplate.content;
        currentVersion.value = systemTemplate.version;
        isPublished.value = systemTemplate.isPublished;
        status.value = systemTemplate.isPublished ? 'published' : 'draft';

        await loadVersions(projectId);
      } else {
        draftText.value = configData.systemPromptText || '';
        status.value = 'draft';
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '加载配置失败';
      status.value = 'error';
    }
  }

  async function loadVersions(projectId: string) {
    if (!systemTemplateId.value) return;
    try {
      const result = (await apiClient.getTemplateVersions(
        projectId,
        systemTemplateId.value
      )) as any;
      versions.value = result?.data ?? (Array.isArray(result) ? result : []);
    } catch {
      versions.value = [];
    }
  }

  async function saveDraft(projectId: string) {
    saving.value = true;
    errorMessage.value = '';
    message.value = '';
    try {
      const result = (await apiClient.promptConfig.update(projectId, {
        systemPromptText: draftText.value,
      })) as any;
      const data = result?.data ?? result;
      currentVersion.value = data.version ?? data.version ?? 1;
      isPublished.value = false;
      status.value = 'draft';
      message.value = '草稿已保存';

      if (data.templateId || systemTemplateId.value) {
        const tid = data.templateId || systemTemplateId.value;
        if (tid) systemTemplateId.value = tid;
        await loadVersions(projectId);
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '保存草稿失败';
    } finally {
      saving.value = false;
    }
  }

  async function publish(projectId: string) {
    publishing.value = true;
    errorMessage.value = '';
    message.value = '';
    try {
      const result = (await apiClient.promptConfig.publish(projectId)) as any;
      const data = result?.data ?? result;
      if (data.version) currentVersion.value = data.version;
      isPublished.value = true;
      status.value = 'published';
      message.value = `已发布版本 ${data.version || currentVersion.value}`;
      await loadVersions(projectId);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '发布失败';
    } finally {
      publishing.value = false;
    }
  }

  async function rollback(projectId: string, targetVersion: number) {
    rollingBack.value = true;
    errorMessage.value = '';
    message.value = '';
    try {
      (await apiClient.promptConfig.rollback(projectId, { version: targetVersion })) as any;
      message.value = `已回滚到版本 ${targetVersion}`;
      await loadConfig(projectId);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '回滚失败';
    } finally {
      rollingBack.value = false;
    }
  }

  function clearMessages() {
    message.value = '';
    errorMessage.value = '';
  }

  return {
    systemTemplateId,
    draftText,
    currentVersion,
    isPublished,
    versions,
    status,
    saving,
    publishing,
    rollingBack,
    message,
    errorMessage,
    hasDraft,
    hasVersions,
    publishedVersion,
    currentVersionInfo,
    isDraftModified,
    loadConfig,
    loadVersions,
    saveDraft,
    publish,
    rollback,
    clearMessages,
  };
});
