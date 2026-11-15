import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService, type ChapterRecord } from './projects.service';
import type { PersistedProjectState } from './persisted-workspace.types';

const PROJECT_ID = 'p-lock-1';
const OTHER_PROJECT_ID = 'p-lock-2';
const OWNER = 'user-owner';
const EDITOR = 'user-editor';
const VIEWER = 'user-viewer';
const OUTSIDER = 'user-outsider';
const BASE_UPDATED_AT = new Date('2026-11-15T08:00:00.000Z');

interface PersistScope {
  type: string;
  projectId?: string;
  chapterNo?: number;
}

interface KnowledgeStub {
  outlineSummary: string;
  chapters: ChapterRecord[];
  indexVersion: number;
  lastIndexedAt: Date | null;
  workbenchStructuredByChapter?: Record<number, unknown>;
}

interface ServiceInternals {
  projects: Array<{ id: string }>;
  members: Array<{
    projectId: string;
    userId: string;
    role: 'owner' | 'editor' | 'viewer';
    createdAt: Date;
  }>;
  settingsStore: Map<string, unknown>;
  personasStore: Map<string, unknown[]>;
  knowledgeStore: Map<string, KnowledgeStub>;
  indexJobsStore: Map<string, unknown[]>;
  summarizeJobsStore: Map<string, unknown[]>;
  relationEventsStore: Map<string, unknown[]>;
  identityRelationsStore: Map<string, unknown[]>;
  lastActingUserIdByProject: Map<string, string>;
  reservedProjectRouteNames: Set<string>;
  eventCardsService: { ensureProject: (projectId: string) => void };
  persistStateAndAwaitPgSync: (scope: PersistScope) => Promise<void>;
  persistState: () => void;
  indexChapterSummaryVector: (projectId: string, chapter: ChapterRecord) => Promise<void>;
  runContentSafetyForText: (
    projectId: string,
    text: string,
    planId: string,
    stage: string
  ) => Promise<{ blocked: boolean; text: string }>;
  syncPersonaGraphFromChapter: (...args: unknown[]) => Promise<void>;
  bootstrapPersonasAfterImport: (...args: unknown[]) => Promise<Record<string, unknown>>;
  mapPersistedToRuntime: (parsed: PersistedProjectState) => {
    knowledge: Record<string, { chapters: ChapterRecord[] }>;
  };
}

function makeChapter(chapterNo: number, overrides: Partial<ChapterRecord> = {}): ChapterRecord {
  return {
    chapterNo,
    title: `第${chapterNo}章`,
    content: `第${chapterNo}章正文。`,
    summary: `第${chapterNo}章摘要`,
    summarySource: 'fallback',
    updatedAt: BASE_UPDATED_AT,
    isLocked: false,
    ...overrides,
  } as ChapterRecord;
}

function createHarness() {
  const service = Object.create(ProjectsService.prototype) as ProjectsService;
  const internals = service as unknown as ServiceInternals;
  const persistCalls: PersistScope[] = [];
  const flags = { failPersist: false };

  internals.projects = [{ id: PROJECT_ID }, { id: OTHER_PROJECT_ID }];
  internals.members = [
    { projectId: PROJECT_ID, userId: OWNER, role: 'owner', createdAt: new Date() },
    { projectId: PROJECT_ID, userId: EDITOR, role: 'editor', createdAt: new Date() },
    { projectId: PROJECT_ID, userId: VIEWER, role: 'viewer', createdAt: new Date() },
    { projectId: OTHER_PROJECT_ID, userId: OWNER, role: 'owner', createdAt: new Date() },
  ];
  internals.settingsStore = new Map();
  internals.personasStore = new Map();
  internals.knowledgeStore = new Map([
    [
      PROJECT_ID,
      {
        outlineSummary: '',
        chapters: [makeChapter(1), makeChapter(2)],
        indexVersion: 0,
        lastIndexedAt: null,
      },
    ],
    [
      OTHER_PROJECT_ID,
      { outlineSummary: '', chapters: [makeChapter(1)], indexVersion: 0, lastIndexedAt: null },
    ],
  ]);
  internals.indexJobsStore = new Map();
  internals.summarizeJobsStore = new Map();
  internals.relationEventsStore = new Map();
  internals.identityRelationsStore = new Map();
  internals.lastActingUserIdByProject = new Map();
  internals.reservedProjectRouteNames = new Set(['new']);
  internals.eventCardsService = { ensureProject: () => {} };
  internals.persistStateAndAwaitPgSync = async (scope) => {
    persistCalls.push(scope);
    if (flags.failPersist) {
      throw new Error('persist failed');
    }
  };
  internals.persistState = () => {};
  internals.indexChapterSummaryVector = async () => {};
  internals.runContentSafetyForText = async (_projectId, text) => ({ blocked: false, text });
  internals.syncPersonaGraphFromChapter = async () => {};
  internals.bootstrapPersonasAfterImport = async () => ({});

  const chaptersOf = (projectId: string) => internals.knowledgeStore.get(projectId)!.chapters;
  return { service, internals, persistCalls, flags, chaptersOf };
}

test('owner 可锁定/解锁且重复设置幂等，按单章 scope 持久化', async () => {
  const { service, persistCalls, chaptersOf } = createHarness();

  const locked = await service.setChapterLock(PROJECT_ID, 1, true, OWNER);
  assert.equal(locked.isLocked, true);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, true);

  const again = await service.setChapterLock(PROJECT_ID, 1, true, OWNER);
  assert.equal(again.isLocked, true);

  const unlocked = await service.setChapterLock(PROJECT_ID, 1, false, OWNER);
  assert.equal(unlocked.isLocked, false);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, false);

  assert.equal(persistCalls.length, 3);
  for (const scope of persistCalls) {
    assert.deepEqual(scope, { type: 'chapter', projectId: PROJECT_ID, chapterNo: 1 });
  }
});

test('editor 可切换锁定标记', async () => {
  const { service, chaptersOf } = createHarness();
  const result = await service.setChapterLock(PROJECT_ID, 2, true, EDITOR);
  assert.equal(result.isLocked, true);
  assert.equal(chaptersOf(PROJECT_ID)[1].isLocked, true);
});

test('viewer 与非成员修改被拒，状态不变且不持久化', async () => {
  const { service, persistCalls, chaptersOf } = createHarness();
  await assert.rejects(
    () => service.setChapterLock(PROJECT_ID, 1, true, VIEWER),
    NotFoundException
  );
  await assert.rejects(
    () => service.setChapterLock(PROJECT_ID, 1, true, OUTSIDER),
    NotFoundException
  );
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, false);
  assert.equal(persistCalls.length, 0);
});

test('缺失章节被拒，不创建章节也不影响其他章节', async () => {
  const { service, chaptersOf } = createHarness();
  await assert.rejects(
    () => service.setChapterLock(PROJECT_ID, 99, true, OWNER),
    NotFoundException
  );
  assert.equal(chaptersOf(PROJECT_ID).length, 2);
  assert.equal(chaptersOf(PROJECT_ID)[1].isLocked, false);
});

test('非正整数字号被拒', async () => {
  const { service, persistCalls } = createHarness();
  for (const chapterNo of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      () => service.setChapterLock(PROJECT_ID, chapterNo, true, OWNER),
      BadRequestException
    );
  }
  assert.equal(persistCalls.length, 0);
});

test('非布尔 isLocked 被拒且状态不变', async () => {
  const { service, persistCalls, chaptersOf } = createHarness();
  for (const value of ['true', 1, null, undefined]) {
    await assert.rejects(
      () => service.setChapterLock(PROJECT_ID, 1, value as unknown as boolean, OWNER),
      BadRequestException
    );
  }
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, false);
  assert.equal(persistCalls.length, 0);
});

test('切换标记不修改标题、正文、摘要、结构化信息与 updatedAt', async () => {
  const { service, internals, chaptersOf } = createHarness();
  const chapter = chaptersOf(PROJECT_ID)[0];
  chapter.structuredInfo = { characters: [] } as unknown as ChapterRecord['structuredInfo'];
  const before = {
    title: chapter.title,
    content: chapter.content,
    summary: chapter.summary,
    updatedAt: chapter.updatedAt,
    structuredInfo: chapter.structuredInfo,
    indexVersion: internals.knowledgeStore.get(PROJECT_ID)!.indexVersion,
  };

  await service.setChapterLock(PROJECT_ID, 1, true, OWNER);

  assert.equal(chapter.title, before.title);
  assert.equal(chapter.content, before.content);
  assert.equal(chapter.summary, before.summary);
  assert.equal(chapter.updatedAt, before.updatedAt);
  assert.equal(chapter.structuredInfo, before.structuredInfo);
  assert.equal(internals.knowledgeStore.get(PROJECT_ID)!.indexVersion, before.indexVersion);
});

test('持久化失败时恢复原状态，成功后可重试', async () => {
  const { service, flags, chaptersOf } = createHarness();
  flags.failPersist = true;
  await assert.rejects(() => service.setChapterLock(PROJECT_ID, 1, true, OWNER));
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, false);

  flags.failPersist = false;
  const result = await service.setChapterLock(PROJECT_ID, 1, true, OWNER);
  assert.equal(result.isLocked, true);
});

test('项目间相同章号相互独立', async () => {
  const { service, chaptersOf } = createHarness();
  await service.setChapterLock(PROJECT_ID, 1, true, OWNER);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, true);
  assert.equal(chaptersOf(OTHER_PROJECT_ID)[0].isLocked, false);
});

test('正文保存（含内容未变路径）保留锁定标记', async () => {
  const { service, chaptersOf } = createHarness();
  await service.setChapterLock(PROJECT_ID, 1, true, OWNER);

  const changed = await service.upsertChapter(
    PROJECT_ID,
    { chapterNo: 1, title: '第1章 改', content: '修改后的正文。' },
    OWNER
  );
  assert.equal(changed.isLocked, true);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, true);

  const unchanged = await service.upsertChapter(
    PROJECT_ID,
    { chapterNo: 1, title: '第1章 改', content: '修改后的正文。' },
    OWNER
  );
  assert.equal(unchanged.isLocked, true);
});

test('新建章节默认未锁定；插入章节不丢已有标记', async () => {
  const { service, chaptersOf } = createHarness();
  const created = await service.upsertChapter(
    PROJECT_ID,
    { chapterNo: 3, title: '第3章', content: '新章正文。' },
    OWNER
  );
  assert.equal(created.isLocked, false);

  await service.setChapterLock(PROJECT_ID, 2, true, OWNER);
  const inserted = await service.insertChapter(
    PROJECT_ID,
    { chapterNo: 1, title: '插入章', content: '插入正文。' },
    OWNER
  );
  assert.equal(inserted.isLocked, false);
  const shifted = chaptersOf(PROJECT_ID).find((item) => item.title === '第2章');
  assert.equal(shifted?.chapterNo, 3);
  assert.equal(shifted?.isLocked, true);
});

test('导入覆盖保留已有标记，导入新章默认未锁定', async () => {
  const { service, chaptersOf } = createHarness();
  await service.setChapterLock(PROJECT_ID, 1, true, OWNER);

  const result = await service.importChapterConfirm(
    PROJECT_ID,
    '第一章 导入标题\n导入后的第一章正文，这里需要足够长度的文字来通过导入器的有效内容检查。\n第二章 另一章\n导入后的第二章正文，同样需要足够长度的文字来通过导入器的有效内容检查。',
    OWNER,
    { autoExtractRelationEvents: false }
  );

  assert.equal(result.chapters[0].isLocked, true);
  assert.equal(result.chapters[1].isLocked, false);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, true);
  assert.equal(chaptersOf(PROJECT_ID)[1].isLocked, false);
});

test('优化应用保留锁定标记并在响应中返回', async () => {
  const { service, chaptersOf } = createHarness();
  await service.setChapterLock(PROJECT_ID, 1, true, OWNER);
  const chapter = chaptersOf(PROJECT_ID)[0];

  const result = await service.applyChapterOptimization(
    PROJECT_ID,
    1,
    {
      draftText: '优化后的候选正文。',
      expectedChapterUpdatedAt: chapter.updatedAt.toISOString(),
    },
    OWNER
  );

  assert.equal(result.chapter.isLocked, true);
  assert.equal(chaptersOf(PROJECT_ID)[0].isLocked, true);
});

test('旧 JSON 缺字段默认未锁定，已有标记恢复保留', () => {
  const { internals } = createHarness();
  const baseChapter = {
    chapterNo: 1,
    title: '第1章',
    content: '正文',
    summary: '摘要',
    updatedAt: BASE_UPDATED_AT.toISOString(),
  };
  const persisted = {
    projects: [],
    members: [],
    settings: {},
    personas: {},
    knowledge: {
      [PROJECT_ID]: {
        outlineSummary: '',
        chapters: [baseChapter, { ...baseChapter, chapterNo: 2, isLocked: true }],
        indexVersion: 0,
        lastIndexedAt: null,
      },
    },
    indexJobs: {},
    summarizeJobs: {},
    relationEvents: {},
    eventCards: {},
    identityRelations: {},
  } as unknown as PersistedProjectState;

  const restored = internals.mapPersistedToRuntime(persisted);
  assert.equal(restored.knowledge[PROJECT_ID].chapters[0].isLocked, false);
  assert.equal(restored.knowledge[PROJECT_ID].chapters[1].isLocked, true);
});
