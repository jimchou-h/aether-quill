/**
 * 与 `data/project-workspaces.json` 落盘结构一致（供 PG 同步与迁移脚本共用）。
 */

/** 章节侧持久化的结构化匹配信息（与 Prisma `Chapter.structuredInfo` 对齐） */
export interface ChapterStructuredInfoPersisted {
  matchingText: string;
  keywords?: string[];
  /** 规则层从正文匹配到的角色名（用于 sync 拼接 effectiveMatchingText） */
  personaKeywordSupplements?: string[];
  narrativeSummary?: string;
  parseSource?: 'workbench' | 'chapter';
  parsedAt?: string;
  lastError?: string;
}

export interface PersistedProjectState {
  projects: Array<{
    id: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }>;
  members: Array<{
    userId: string;
    projectId: string;
    role: 'owner' | 'editor' | 'viewer';
    createdAt: string;
  }>;
  settings: Record<
    string,
    {
      systemPromptText: string;
      activePersonaId: string | null;
      chapterSummaryPromptCount?: number;
      chapterSummaryMemoryCount?: number;
      priorChapterTailChars?: number;
      contextExcerptMaxChars?: number;
      generationTemperature?: number;
      updatePersonaOnSave?: boolean;
      generateRelationEventsOnSave?: boolean;
      updatedAt: string;
    }
  >;
  personas: Record<
    string,
    Array<{
      id: string;
      name: string;
      profile: string;
      state: string;
      tone?: string;
      constraints?: string[];
      status: 'draft' | 'published';
      relationEventIds?: string[];
      appearedChapterNos?: number[];
      lastAppearedChapterNo?: number | null;
      createdAt: string;
      updatedAt: string;
    }>
  >;
  knowledge: Record<
    string,
    {
      outlineSummary: string;
      chapters: Array<{
        chapterNo: number;
        title: string;
        content: string;
        contentHash?: string;
        summary: string;
        summarySource?: string;
        summaryUpdatedAt?: string;
        structuredInfo?: ChapterStructuredInfoPersisted;
        updatedAt: string;
      }>;
      /** 工作台预写章节的结构化匹配（未落正文前不占章节列表） */
      workbenchStructuredByChapter?: Record<string, ChapterStructuredInfoPersisted>;
      indexVersion: number;
      lastIndexedAt: string | null;
    }
  >;
  indexJobs: Record<
    string,
    Array<{
      id: string;
      projectId: string;
      mode: string;
      status: string;
      totalChapters: number;
      processedChapters: number;
      createdAt: string;
      completedAt: string | null;
      errorMessage: string | null;
    }>
  >;
  summarizeJobs: Record<
    string,
    Array<{
      id: string;
      projectId: string;
      scope: string;
      chapterNo: number | null;
      status: string;
      totalChapters: number;
      processedChapters: number;
      chapterNos: number[];
      summaries: Array<{
        chapterNo: number;
        summary: string;
        summarySource: string;
      }>;
      createdAt: string;
      completedAt: string | null;
      errorMessage: string | null;
    }>
  >;
  relationEvents: Record<
    string,
    Array<{
      id: string;
      projectId: string;
      protagonist: string;
      counterparty: string;
      actors: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo: number | null;
      protagonistPersonaId?: string | null;
      counterpartyPersonaId?: string | null;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
    }>
  >;
}
