import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiClient, type CitationItem, type ConsistencyNote } from '../services/api';

export type GenerationStatus = 'idle' | 'streaming' | 'done' | 'error';

export const useGenerationStore = defineStore('generation', () => {
  const status = ref<GenerationStatus>('idle');
  const traceId = ref('');
  const chapterNo = ref(1);
  const draftText = ref('');
  const citations = ref<CitationItem[]>([]);
  const consistencyNotes = ref<ConsistencyNote[]>([]);
  const errorMessage = ref('');

  const isStreaming = computed(() => status.value === 'streaming');
  const isDone = computed(() => status.value === 'done');
  const isError = computed(() => status.value === 'error');
  const isIdle = computed(() => status.value === 'idle');

  function reset() {
    status.value = 'idle';
    traceId.value = '';
    chapterNo.value = 1;
    draftText.value = '';
    citations.value = [];
    consistencyNotes.value = [];
    errorMessage.value = '';
  }

  async function generate(
    projectId: string,
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords: number;
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
        onEnd: (id, cites, notes) => {
          traceId.value = id;
          citations.value = cites;
          consistencyNotes.value = notes;
          status.value = 'done';
        },
        onError: (msg) => {
          errorMessage.value = msg;
          status.value = 'error';
        },
      });
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '生成请求失败';
      status.value = 'error';
    }
  }

  async function acceptDraft(projectId: string, chapterNoVal: number) {
    if (!draftText.value.trim()) {
      errorMessage.value = '草稿内容为空，无法接受';
      return;
    }

    try {
      await apiClient.upsertChapter(projectId, {
        chapterNo: chapterNoVal,
        title: `第${chapterNoVal}章`,
        content: draftText.value,
      });
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '接受草稿失败';
    }
  }

  return {
    status,
    traceId,
    chapterNo,
    draftText,
    citations,
    consistencyNotes,
    errorMessage,
    isStreaming,
    isDone,
    isError,
    isIdle,
    reset,
    generate,
    acceptDraft,
  };
});
