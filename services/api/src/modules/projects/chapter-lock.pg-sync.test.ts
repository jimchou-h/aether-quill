import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  buildChapterRow,
  loadWorkspaceFromPostgres,
  upsertChapterInPostgres,
} from '../../persistence/workspace-pg-sync';
import type { PersistedProjectState } from './persisted-workspace.types';

type PersistedChapter = PersistedProjectState['knowledge'][string]['chapters'][number];

function makePersistedChapter(overrides: Partial<PersistedChapter> = {}): PersistedChapter {
  return {
    chapterNo: 1,
    title: '第1章',
    content: '正文',
    summary: '摘要',
    updatedAt: '2026-11-15T08:00:00.000Z',
    ...overrides,
  } as PersistedChapter;
}

test('buildChapterRow 映射 isLocked，缺字段按 false 落库', () => {
  assert.equal(buildChapterRow('p1', makePersistedChapter({ isLocked: true })).isLocked, true);
  assert.equal(buildChapterRow('p1', makePersistedChapter({ isLocked: false })).isLocked, false);
  assert.equal(buildChapterRow('p1', makePersistedChapter()).isLocked, false);
});

test('单章 upsert 的 create 与 update 均写入 isLocked', async () => {
  const upserts: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        project: { update: async () => ({}) },
        chapter: {
          upsert: async (args: {
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) => {
            upserts.push(args);
            return {};
          },
        },
      }),
  } as unknown as PrismaClient;

  await upsertChapterInPostgres(prisma, 'p1', makePersistedChapter({ isLocked: true }));
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].create.isLocked, true);
  assert.equal(upserts[0].update.isLocked, true);

  await upsertChapterInPostgres(prisma, 'p1', makePersistedChapter({ isLocked: false }));
  assert.equal(upserts[1].update.isLocked, false);
});

test('PG 加载章节时恢复 isLocked', async () => {
  const chapterRow = {
    chapterNo: 1,
    title: '第1章',
    content: '正文',
    summary: '摘要',
    summarySource: null,
    summaryUpdatedAt: null,
    structuredInfo: null,
    updatedAt: new Date('2026-11-15T08:00:00.000Z'),
    isLocked: true,
  };
  const projectRow = {
    id: 'p1',
    name: '项目',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    outlineSummary: '',
    indexVersion: 0,
    lastIndexedAt: null,
    workbenchStructuredJson: null,
    identityRelationsJson: null,
    members: [],
    settings: null,
    personas: [],
    chapters: [chapterRow],
    indexJobs: [],
    summaryJobs: [],
    relationEvents: [],
    eventCards: [],
  };
  const prisma = {
    project: {
      count: async () => 1,
      findMany: async () => [projectRow],
    },
  } as unknown as PrismaClient;

  const loaded = await loadWorkspaceFromPostgres(prisma);
  assert.ok(loaded);
  assert.equal(loaded!.knowledge.p1.chapters[0].isLocked, true);

  projectRow.chapters = [{ ...chapterRow, isLocked: false }];
  const unlocked = await loadWorkspaceFromPostgres(prisma);
  assert.equal(unlocked!.knowledge.p1.chapters[0].isLocked, false);
});
