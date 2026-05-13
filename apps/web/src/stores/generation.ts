import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  apiClient,
  type CitationItem,
  type ConsistencyNote,
  type UsedRelationEventItem,
} from '../services/api';
import { presentError, presentErrorFromCaught } from '../utils/pageFeedback';

/**
 * 生成状态枚举
 * @typedef {'idle' | 'streaming' | 'done' | 'error'} GenerationStatus
 */
export type GenerationStatus = 'idle' | 'streaming' | 'done' | 'error';

/**
 * 生成状态管理 Store
 * 用于管理章节草稿生成的状态和结果
 */
export const useGenerationStore = defineStore('generation', () => {
  /** 生成状态 */
  const status = ref<GenerationStatus>('idle');
  /** 追踪ID */
  const traceId = ref('');
  /** 当前章节号 */
  const chapterNo = ref(1);
  /** 生成的草稿文本 */
  const draftText = ref('');
  /** 引用证据列表 */
  const citations = ref<CitationItem[]>([]);
  /** 一致性提示列表 */
  const consistencyNotes = ref<ConsistencyNote[]>([]);
  /** 本次使用的关系事件 */
  const usedRelationEvents = ref<UsedRelationEventItem[]>([]);
  /** 错误消息 */
  const errorMessage = ref('');
  /** 是否正在落库 */
  const accepting = ref(false);

  /** 是否正在生成 */
  const isStreaming = computed(() => status.value === 'streaming');
  /** 是否生成完成 */
  const isDone = computed(() => status.value === 'done');
  /** 是否发生错误 */
  const isError = computed(() => status.value === 'error');
  /** 是否处于空闲状态 */
  const isIdle = computed(() => status.value === 'idle');
  /** 是否正在接受草稿 */
  const isAccepting = computed(() => accepting.value);

  /**
   * 重置所有状态
   */
  function reset() {
    status.value = 'idle';
    traceId.value = '';
    chapterNo.value = 1;
    draftText.value = '';
    citations.value = [];
    consistencyNotes.value = [];
    usedRelationEvents.value = [];
    errorMessage.value = '';
    accepting.value = false;
  }

  /**
   * 生成章节草稿
   * @param {string} projectId - 项目ID
   * @param {Object} task - 生成任务参数
   * @param {number} task.chapterNo - 章节号
   * @param {string} task.goal - 本章目标
   * @param {string} task.pov - 叙事视角
   * @param {string[]} task.mustInclude - 必须包含的内容
   * @param {string[]} task.avoid - 禁止内容
   * @param {number} [task.targetWords] - 目标字数；省略表示不限制
   */
  async function generate(
    projectId: string,
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords?: number;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    }
  ) {
    reset();
    status.value = 'streaming';
    draftText.value = '';

    try {
      await apiClient.generateDraftSSE(projectId, task, [], {
        onStart: (id, chNo) => {
          traceId.value = id;
          chapterNo.value = chNo;
        },
        onContent: (text) => {
          draftText.value += text;
        },
        onEnd: (id, cites, notes, usedEvents) => {
          traceId.value = id;
          citations.value = cites;
          consistencyNotes.value = notes;
          usedRelationEvents.value = usedEvents;
          status.value = 'done';
        },
        onError: (msg) => {
          errorMessage.value = presentError(msg);
          status.value = 'error';
        },
      });
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '生成请求失败');
      status.value = 'error';
    }
  }

  /**
   * 接受草稿并保存到章节
   * @param {string} projectId - 项目ID
   * @param {number} chapterNoVal - 章节号
   */
  async function acceptDraft(projectId: string, chapterNoVal: number) {
    if (!draftText.value.trim()) {
      errorMessage.value = presentError('草稿内容为空，无法接受');
      return;
    }

    accepting.value = true;
    try {
      await apiClient.upsertChapter(projectId, {
        chapterNo: chapterNoVal,
        title: `第${chapterNoVal}章`,
        content: draftText.value,
      });
    } catch (error) {
      errorMessage.value = presentErrorFromCaught(error, '接受草稿失败');
    } finally {
      accepting.value = false;
    }
  }

  return {
    status,
    traceId,
    chapterNo,
    draftText,
    citations,
    consistencyNotes,
    usedRelationEvents,
    errorMessage,
    accepting,
    isStreaming,
    isDone,
    isError,
    isIdle,
    isAccepting,
    reset,
    generate,
    acceptDraft,
  };
});
