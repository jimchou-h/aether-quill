import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface ChapterEntry {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
  updatedAt: string;
}

export const useEditorStore = defineStore('editor', () => {
  const chapters = ref<ChapterEntry[]>([]);
  const activeChapterNo = ref<number | null>(null);
  const editingContent = ref('');

  const activeChapter = computed(() => {
    if (activeChapterNo.value === null) return null;
    return chapters.value.find((ch) => ch.chapterNo === activeChapterNo.value) || null;
  });

  function setChapters(list: ChapterEntry[]) {
    chapters.value = list;
  }

  function selectChapter(chapterNo: number) {
    activeChapterNo.value = chapterNo;
    const found = chapters.value.find((ch) => ch.chapterNo === chapterNo);
    editingContent.value = found?.content || '';
  }

  function updateEditingContent(content: string) {
    editingContent.value = content;
  }

  function addOrUpdateChapter(chapter: ChapterEntry) {
    const index = chapters.value.findIndex((ch) => ch.chapterNo === chapter.chapterNo);
    if (index >= 0) {
      chapters.value[index] = chapter;
    } else {
      chapters.value.push(chapter);
    }
  }

  function clear() {
    chapters.value = [];
    activeChapterNo.value = null;
    editingContent.value = '';
  }

  return {
    chapters,
    activeChapterNo,
    editingContent,
    activeChapter,
    setChapters,
    selectChapter,
    updateEditingContent,
    addOrUpdateChapter,
    clear,
  };
});
