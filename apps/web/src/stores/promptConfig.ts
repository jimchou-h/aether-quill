import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import { apiClient, type PromptTemplateItem, type PromptConfigVersionItem } from '../services/api';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

/**
 * 配置状态枚举
 * @typedef {'draft' | 'published' | 'loading' | 'error'} ConfigStatus
 */
export type ConfigStatus = 'draft' | 'published' | 'loading' | 'error';

function pickSystemTemplate(templates: PromptTemplateItem[]): PromptTemplateItem | undefined {
  const systems = templates.filter((row) => row.category === 'system');
  return (
    systems.find((row) => row.isPublished && row.content.trim()) ||
    systems.find((row) => row.content.trim()) ||
    systems[0]
  );
}

function latestPublished(versions: PromptConfigVersionItem[]): PromptConfigVersionItem | null {
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    if (versions[i]?.isPublished && versions[i].content.trim()) {
      return versions[i];
    }
  }
  return null;
}

/**
 * 提示词配置状态管理 Store
 * 用于管理系统提示词的草稿、版本和发布状态
 */
export const usePromptConfigStore = defineStore('promptConfig', () => {
  /** 最近一次成功加载的项目，防止跨项目误存 */
  const loadedProjectId = shallowRef('');
  /** 系统模板ID */
  const systemTemplateId = shallowRef('');
  /** 草稿文本 */
  const draftText = shallowRef('');
  /** 当前版本号 */
  const currentVersion = shallowRef(0);
  /** 是否已发布 */
  const isPublished = shallowRef(false);
  /** 版本列表 */
  const versions = shallowRef<PromptConfigVersionItem[]>([]);
  /** 配置状态 */
  const status = shallowRef<ConfigStatus>('loading');
  /** 是否正在保存 */
  const saving = shallowRef(false);
  /** 是否正在发布 */
  const publishing = shallowRef(false);
  /** 是否正在回滚 */
  const rollingBack = shallowRef(false);
  /** 成功消息 */
  const message = shallowRef('');
  /** 错误消息 */
  const errorMessage = shallowRef('');

  /** 是否有草稿内容 */
  const hasDraft = computed(() => draftText.value.trim().length > 0);
  /** 是否有多个版本 */
  const hasVersions = computed(() => versions.value.length > 1);
  /** 当前发布的版本 */
  const publishedVersion = computed(() => latestPublished(versions.value));
  /** 当前版本信息 */
  const currentVersionInfo = computed(
    () => versions.value.find((v) => v.version === currentVersion.value) || null
  );
  /** 草稿是否已修改（相对最近一次保存的版本） */
  const isDraftModified = computed(() => {
    const lastVersion = versions.value[versions.value.length - 1];
    return lastVersion ? draftText.value !== lastVersion.content : true;
  });

  /** 当前编辑内容是否尚未发布（或相对已发布版本有变更） */
  const canPublish = computed(() => {
    const draft = draftText.value.trim();
    if (!draft) {
      return false;
    }
    if (!isPublished.value) {
      return true;
    }
    const published = publishedVersion.value;
    return published ? draft !== published.content : true;
  });

  function assertCanPersist(projectId: string, text: string) {
    if (!text.trim()) {
      throw new Error('系统提示词不能为空');
    }
    if (loadedProjectId.value && loadedProjectId.value !== projectId) {
      throw new Error('项目已切换，请重新加载后再保存');
    }
  }

  async function persistDraft(projectId: string) {
    assertCanPersist(projectId, draftText.value);
    const result = await apiClient.promptConfig.update(projectId, {
      systemPromptText: draftText.value,
    });
    const data = apiClient.unwrapPayload<{
      systemPromptText?: string;
      templateId?: string;
      version?: number;
      isPublished?: boolean;
    }>(result);
    currentVersion.value = data.version ?? currentVersion.value;
    isPublished.value = data.isPublished === true;
    status.value = isPublished.value ? 'published' : 'draft';
    if (data.templateId || systemTemplateId.value) {
      const tid = data.templateId || systemTemplateId.value;
      if (tid) {
        systemTemplateId.value = tid;
      }
      await loadVersions(projectId);
    }
    return data;
  }

  /**
   * 加载提示词配置
   * @param {string} projectId - 项目ID
   */
  async function loadConfig(projectId: string) {
    status.value = 'loading';
    errorMessage.value = '';
    try {
      const configResult = await apiClient.promptConfig.get(projectId);
      const configData = apiClient.unwrapPayload<{
        systemPromptText?: string;
        templates?: PromptTemplateItem[];
      }>(configResult);
      const templates: PromptTemplateItem[] = Array.isArray(configData.templates)
        ? configData.templates
        : [];
      const systemTemplate = pickSystemTemplate(templates);

      if (systemTemplate) {
        systemTemplateId.value = systemTemplate.id;
        currentVersion.value = systemTemplate.version;
        isPublished.value = systemTemplate.isPublished;
        status.value = systemTemplate.isPublished ? 'published' : 'draft';
        await loadVersions(projectId);
        const published = latestPublished(versions.value);
        draftText.value =
          systemTemplate.content.trim() || published?.content || configData.systemPromptText || '';
      } else {
        systemTemplateId.value = '';
        versions.value = [];
        draftText.value = configData.systemPromptText || '';
        status.value = 'draft';
      }
      loadedProjectId.value = projectId;
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
      const result = await apiClient.getTemplateVersions(projectId, systemTemplateId.value);
      const payload = apiClient.unwrapPayload<PromptConfigVersionItem[]>(result);
      versions.value = Array.isArray(payload) ? payload : [];
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
      await persistDraft(projectId);
      message.value = presentSuccess(isPublished.value ? '已保存' : '草稿已保存');
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '保存草稿失败');
    } finally {
      saving.value = false;
    }
  }

  /**
   * 发布配置（先持久化当前编辑区内容，再发布）
   * @param {string} projectId - 项目ID
   */
  async function publish(projectId: string) {
    publishing.value = true;
    errorMessage.value = '';
    message.value = '';
    try {
      assertCanPersist(projectId, draftText.value);
      const result = await apiClient.promptConfig.publish(projectId, {
        systemPromptText: draftText.value,
      });
      const data = apiClient.unwrapPayload<{ version?: number }>(result);
      if (data.version) {
        currentVersion.value = data.version;
      }
      isPublished.value = true;
      status.value = 'published';
      await loadConfig(projectId);
      message.value = presentSuccess(`已发布版本 ${data.version || currentVersion.value}`);
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
      await apiClient.promptConfig.rollback(projectId, { version: targetVersion });
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
    canPublish,
    loadConfig,
    loadVersions,
    saveDraft,
    publish,
    rollback,
    clearMessages,
  };
});
