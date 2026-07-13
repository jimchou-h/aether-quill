export type WorkspaceMergeRecord = {
  projects: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; projectId: string }>;
};

export type KnowledgeChapterMergeRecord = {
  chapterNo: number;
  updatedAt: Date | string;
  title: string;
  content: string;
  summary?: string;
  summarySource?: string;
  summaryUpdatedAt?: Date | string;
  contentHash?: string;
  structuredInfo?: unknown;
};

/** 找出 JSON 镜像中有、PG 加载结果中缺的项目 ID */
export function findMissingProjectIdsFromJsonMirror(
  loaded: WorkspaceMergeRecord,
  fromJson: WorkspaceMergeRecord
): string[] {
  const loadedProjectIds = new Set(loaded.projects.map((project) => project.id));
  return fromJson.projects
    .filter((project) => !loadedProjectIds.has(project.id))
    .map((project) => project.id);
}

/** 为缺失项目补全 members（仅新增，不覆盖已有） */
export function mergeMembersForProjectIds<T extends { userId: string; projectId: string }>(
  existingMembers: T[],
  jsonMembers: T[],
  projectIds: Set<string>
): T[] {
  const memberKeys = new Set(existingMembers.map((member) => `${member.userId}:${member.projectId}`));
  const merged = [...existingMembers];
  for (const member of jsonMembers) {
    if (!projectIds.has(member.projectId)) {
      continue;
    }
    const key = `${member.userId}:${member.projectId}`;
    if (memberKeys.has(key)) {
      continue;
    }
    merged.push(member);
    memberKeys.add(key);
  }
  return merged;
}

export function chapterUpdatedAtMs(chapter: KnowledgeChapterMergeRecord): number {
  return new Date(chapter.updatedAt).getTime();
}

export function knowledgeChaptersMaxUpdatedAtMs(chapters: KnowledgeChapterMergeRecord[]): number {
  let max = 0;
  for (const chapter of chapters) {
    const ms = chapterUpdatedAtMs(chapter);
    if (ms > max) {
      max = ms;
    }
  }
  return max;
}

/** 将 JSON 镜像中较新的章节合并进 PG 已加载结果（含删除同步） */
export function mergeKnowledgeChaptersFromJsonMirror<T extends KnowledgeChapterMergeRecord>(
  loadedChapters: T[],
  jsonChapters: KnowledgeChapterMergeRecord[],
  cloneJsonChapter: (jsonChapter: KnowledgeChapterMergeRecord) => T
): { changed: boolean } {
  const jsonByNo = new Map(jsonChapters.map((chapter) => [chapter.chapterNo, chapter]));
  let changed = false;

  for (const jsonChapter of jsonChapters) {
    const loadedChapter = loadedChapters.find((chapter) => chapter.chapterNo === jsonChapter.chapterNo);
    const jsonMs = chapterUpdatedAtMs(jsonChapter);
    const loadedMs = loadedChapter ? chapterUpdatedAtMs(loadedChapter) : 0;
    if (!loadedChapter || jsonMs > loadedMs) {
      if (loadedChapter) {
        Object.assign(loadedChapter, cloneJsonChapter(jsonChapter));
      } else {
        loadedChapters.push(cloneJsonChapter(jsonChapter));
      }
      changed = true;
    }
  }

  const jsonMax = knowledgeChaptersMaxUpdatedAtMs(jsonChapters);
  const loadedMax = knowledgeChaptersMaxUpdatedAtMs(loadedChapters);
  if (jsonMax >= loadedMax) {
    for (let index = loadedChapters.length - 1; index >= 0; index -= 1) {
      const chapter = loadedChapters[index]!;
      if (!jsonByNo.has(chapter.chapterNo)) {
        loadedChapters.splice(index, 1);
        changed = true;
      }
    }
  }

  loadedChapters.sort((a, b) => a.chapterNo - b.chapterNo);
  return { changed };
}

export function shouldMergeOutlineFromJson(
  loadedOutline: string,
  jsonOutline: string,
  loadedChapters: KnowledgeChapterMergeRecord[],
  jsonChapters: KnowledgeChapterMergeRecord[]
): boolean {
  if (loadedOutline === jsonOutline) {
    return false;
  }
  const loadedMax = knowledgeChaptersMaxUpdatedAtMs(loadedChapters);
  const jsonMax = knowledgeChaptersMaxUpdatedAtMs(jsonChapters);
  return jsonMax >= loadedMax;
}
