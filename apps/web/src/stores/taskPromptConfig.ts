import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiClient, type TaskPromptListItem } from '../services/api';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

export const useTaskPromptConfigStore = defineStore('taskPromptConfig', () => {
  const items = ref<TaskPromptListItem[]>([]);
  const drafts = ref<Record<string, string>>({});
  const status = ref<'idle' | 'loading' | 'error'>('idle');
  const message = ref('');
  const errorMessage = ref('');
  const savingKey = ref('');
  const publishingKey = ref('');
  const rollingBackKey = ref('');

  const chapterOptimizeItems = computed(() => items.value);

  function draftFor(templateKey: string): string {
    return drafts.value[templateKey] ?? '';
  }

  function itemFor(templateKey: string): TaskPromptListItem | undefined {
    return items.value.find((item) => item.templateKey === templateKey);
  }

  function isDraftModified(templateKey: string): boolean {
    const item = itemFor(templateKey);
    if (!item) {
      return false;
    }
    return draftFor(templateKey) !== item.draftText;
  }

  function canPublish(templateKey: string): boolean {
    const item = itemFor(templateKey);
    if (!item) {
      return false;
    }
    const draft = draftFor(templateKey).trim();
    return draft.length > 0 && draft !== item.publishedText.trim();
  }

  function isPublished(templateKey: string): boolean {
    const item = itemFor(templateKey);
    if (!item) {
      return false;
    }
    return item.hasCustomPublished && item.publishedText === draftFor(templateKey);
  }

  function canRollback(templateKey: string): boolean {
    const item = itemFor(templateKey);
    return Boolean(item && item.version > 1);
  }

  function setDraft(templateKey: string, text: string) {
    drafts.value = { ...drafts.value, [templateKey]: text };
  }

  async function loadList(projectId: string) {
    status.value = 'loading';
    errorMessage.value = '';
    try {
      const list = await apiClient.taskPrompts.list(projectId);
      items.value = list;
      const nextDrafts: Record<string, string> = {};
      for (const item of list) {
        nextDrafts[item.templateKey] = item.draftText;
      }
      drafts.value = nextDrafts;
      status.value = 'idle';
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '加载任务 Prompt 失败');
      status.value = 'error';
    }
  }

  async function saveDraft(projectId: string, templateKey: string) {
    savingKey.value = templateKey;
    errorMessage.value = '';
    message.value = '';
    try {
      const updated = await apiClient.taskPrompts.saveDraft(
        projectId,
        templateKey,
        draftFor(templateKey)
      );
      items.value = items.value.map((item) =>
        item.templateKey === templateKey ? updated : item
      );
      setDraft(templateKey, updated.draftText);
      message.value = presentSuccess(`${updated.name} 草稿已保存`);
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '保存任务 Prompt 草稿失败');
    } finally {
      savingKey.value = '';
    }
  }

  async function publish(projectId: string, templateKey: string) {
    publishingKey.value = templateKey;
    errorMessage.value = '';
    message.value = '';
    try {
      if (isDraftModified(templateKey)) {
        await apiClient.taskPrompts.saveDraft(projectId, templateKey, draftFor(templateKey));
      }
      const result = await apiClient.taskPrompts.publish(projectId, templateKey);
      const refreshed = await apiClient.taskPrompts.get(projectId, templateKey);
      items.value = items.value.map((item) =>
        item.templateKey === templateKey ? refreshed : item
      );
      setDraft(templateKey, refreshed.draftText);
      message.value = presentSuccess(
        `${refreshed.name} 已发布（v${result.version || refreshed.version}）`
      );
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '发布任务 Prompt 失败');
    } finally {
      publishingKey.value = '';
    }
  }

  async function rollback(projectId: string, templateKey: string) {
    rollingBackKey.value = templateKey;
    errorMessage.value = '';
    message.value = '';
    try {
      const result = await apiClient.taskPrompts.rollback(projectId, templateKey);
      const refreshed = await apiClient.taskPrompts.get(projectId, templateKey);
      items.value = items.value.map((item) =>
        item.templateKey === templateKey ? refreshed : item
      );
      setDraft(templateKey, refreshed.draftText);
      message.value = presentSuccess(
        `${refreshed.name} 已回滚（v${result.version || refreshed.version}）`
      );
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '回滚任务 Prompt 失败');
    } finally {
      rollingBackKey.value = '';
    }
  }

  async function restoreWarehouseDefault(projectId: string, templateKey: string) {
    const item = itemFor(templateKey);
    if (!item) {
      return;
    }
    setDraft(templateKey, item.defaultText);
    await saveDraft(projectId, templateKey);
  }

  function clearMessages() {
    message.value = '';
    errorMessage.value = '';
  }

  return {
    items,
    drafts,
    status,
    message,
    errorMessage,
    savingKey,
    publishingKey,
    rollingBackKey,
    chapterOptimizeItems,
    draftFor,
    itemFor,
    isDraftModified,
    isPublished,
    canPublish,
    canRollback,
    setDraft,
    loadList,
    saveDraft,
    publish,
    rollback,
    restoreWarehouseDefault,
    clearMessages,
  };
});
