import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

/**
 * 章节条目接口定义
 * @interface ChapterEntry
 * @property {number} chapterNo - 章节号
 * @property {string} title - 章节标题
 * @property {string} content - 章节内容
 * @property {string} summary - 章节摘要
 * @property {string} updatedAt - 更新时间
 */
export interface ChapterEntry {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
  updatedAt: string;
}

/**
 * 编辑器状态管理 Store
 * 用于管理章节列表、当前编辑章节和编辑内容
 */
export const useEditorStore = defineStore('editor', () => {
  /** 章节列表 */
  const chapters = ref<ChapterEntry[]>([]);
  /** 当前激活的章节号 */
  const activeChapterNo = ref<number | null>(null);
  /** 当前编辑的内容 */
  const editingContent = ref('');

  /**
   * 当前激活的章节对象
   * @returns {ChapterEntry | null} 当前章节或null
   */
  const activeChapter = computed(() => {
    if (activeChapterNo.value === null) return null;
    return chapters.value.find((ch) => ch.chapterNo === activeChapterNo.value) || null;
  });

  /**
   * 设置章节列表
   * @param {ChapterEntry[]} list - 章节列表
   */
  function setChapters(list: ChapterEntry[]) {
    chapters.value = list;
  }

  /**
   * 选择章节进行编辑
   * @param {number} chapterNo - 章节号
   */
  function selectChapter(chapterNo: number) {
    activeChapterNo.value = chapterNo;
    const found = chapters.value.find((ch) => ch.chapterNo === chapterNo);
    editingContent.value = found?.content || '';
  }

  /**
   * 更新编辑内容
   * @param {string} content - 内容
   */
  function updateEditingContent(content: string) {
    editingContent.value = content;
  }

  /**
   * 添加或更新章节
   * @param {ChapterEntry} chapter - 章节对象
   */
  function addOrUpdateChapter(chapter: ChapterEntry) {
    const index = chapters.value.findIndex((ch) => ch.chapterNo === chapter.chapterNo);
    if (index >= 0) {
      chapters.value[index] = chapter;
    } else {
      chapters.value.push(chapter);
    }
  }

  /**
   * 清空所有状态
   */
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
