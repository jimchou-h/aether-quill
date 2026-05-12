import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient, type PromptTemplateItem, type PromptConfigVersionItem } from '../services/api';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

/**
 * 配置状态枚举
 * @typedef {'draft' | 'published' | 'loading' | 'error'} ConfigStatus
 */
export type ConfigStatus = 'draft' | 'published' | 'loading' | 'error';

/**
 * 提示词配置状态管理 Store
 * 用于管理系统提示词的草稿、版本和发布状态
 */
export const usePromptConfigStore = defineStore('promptConfig', () => {
  /** 系统模板ID */
  const systemTemplateId = ref('');
  /** 草稿文本 */
  const draftText = ref('');
  /** 当前版本号 */
  const currentVersion = ref(0);
  /** 是否已发布 */
  const isPublished = ref(false);
  /** 版本列表 */
  const versions = ref<PromptConfigVersionItem[]>([]);
  /** 配置状态 */
  const status = ref<ConfigStatus>('loading');
  /** 是否正在保存 */
  const saving = ref(false);
  /** 是否正在发布 */
  const publishing = ref(false);
  /** 是否正在回滚 */
  const rollingBack = ref(false);
  /** 成功消息 */
  const message = ref('');
  /** 错误消息 */
  const errorMessage = ref('');

  /** 是否有草稿内容 */
  const hasDraft = computed(() => draftText.value.length > 0);
  /** 是否有多个版本 */
  const hasVersions = computed(() => versions.value.length > 1);
  /** 当前发布的版本 */
  const publishedVersion = computed(() => versions.value.find((v) => v.isPublished) || null);
  /** 当前版本信息 */
  const currentVersionInfo = computed(
    () => versions.value.find((v) => v.version === currentVersion.value) || null
  );
  /** 草稿是否已修改 */
  const isDraftModified = computed(() => {
    const lastVersion = versions.value[versions.value.length - 1];
    return lastVersion ? draftText.value !== lastVersion.content : true;
  });

  /**
   * 加载提示词配置
   * @param {string} projectId - 项目ID
   */
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
      errorMessage.value = presentErrorFromCaught(error, '加载配置失败');
      status.value = 'error';
    }
  }

  /**
   * 加载版本历史
   * @param {string} projectId - 项目ID
   */
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

  /**
   * 保存草稿
   * @param {string} projectId - 项目ID
   */
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
      message.value = presentSuccess('草稿已保存');

      if (data.templateId || systemTemplateId.value) {
        const tid = data.templateId || systemTemplateId.value;
        if (tid) systemTemplateId.value = tid;
        await loadVersions(projectId);
      }
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '保存草稿失败');
    } finally {
      saving.value = false;
    }
  }

  /**
   * 发布配置
   * @param {string} projectId - 项目ID
   */
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
      message.value = presentSuccess(`已发布版本 ${data.version || currentVersion.value}`);
      await loadVersions(projectId);
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '发布失败');
    } finally {
      publishing.value = false;
    }
  }

  /**
   * 回滚到指定版本
   * @param {string} projectId - 项目ID
   * @param {number} targetVersion - 目标版本号
   */
  async function rollback(projectId: string, targetVersion: number) {
    rollingBack.value = true;
    errorMessage.value = '';
    message.value = '';
    try {
      (await apiClient.promptConfig.rollback(projectId, { version: targetVersion })) as any;
      message.value = presentSuccess(`已回滚到版本 ${targetVersion}`);
      await loadConfig(projectId);
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '回滚失败');
    } finally {
      rollingBack.value = false;
    }
  }

  /**
   * 清除消息提示
   */
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
