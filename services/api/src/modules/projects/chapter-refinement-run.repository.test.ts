import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  MapChapterRefinementRunRepository,
  PgChapterRefinementRunRepository,
  RefinementRunConflictError,
  type ChapterRefinementRunRepository,
} from './chapter-refinement-run.repository';
import {
  createInitialRefinementCheckpoint,
  resolveRefinementPolicy,
  type RefinementRunRecord,
} from './chapter-refinement.types';

function makeRecord(overrides: Partial<RefinementRunRecord> = {}): RefinementRunRecord {
  const baseText = '原文一。\n\n原文二。';
  return {
    runId: 'run-1',
    projectId: 'p1',
    chapterNo: 1,
    creatorId: 'u1',
    clientRequestId: 'c1',
    payloadHash: 'h1',
    status: 'queued',
    phase: 'reading',
    revision: 1,
    attemptId: null,
    pauseReason: null,
    resumable: false,
    baseUpdatedAt: '2026-10-06T00:00:00.000Z',
    baseHash: 'base-hash',
    rewritePolicy: 'preserve-plot',
    snapshot: {
      instruction: '优化',
      baseTitle: '第一章',
      baseText,
      systemPromptText: '系统提示',
      templateVersions: [],
      modelRoute: null,
      resolvedPolicy: resolveRefinementPolicy({}),
      frozenAt: '2026-10-06T00:00:00.000Z',
    },
    checkpoint: createInitialRefinementCheckpoint(baseText),
    tombstone: false,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    expiresAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}

/** 两种实现必须共享的行为；PG 可用时同一套断言会再跑一遍。 */
async function runRepositoryContract(
  repo: ChapterRefinementRunRepository,
  label: string
): Promise<void> {
  await repo.clearForTest();

  // 写入后可按 id 读回，字段无损
  const created = await repo.create(makeRecord());
  assert.equal(created.runId, 'run-1');
  const loaded = await repo.getById('run-1');
  assert.ok(loaded, `${label}: getById 应返回记录`);
  assert.equal(loaded?.snapshot.baseText, '原文一。\n\n原文二。');
  assert.equal(loaded?.checkpoint.acceptedDraftText, '原文一。\n\n原文二。');
  assert.equal(loaded?.baseUpdatedAt, '2026-10-06T00:00:00.000Z');

  // 幂等键唯一
  await assert.rejects(
    () => repo.create(makeRecord({ runId: 'run-2' })),
    (error: unknown) =>
      error instanceof RefinementRunConflictError && error.kind === 'idempotency_key',
    `${label}: 同 clientRequestId 应冲突`
  );

  // 同章同作者单活动 run
  await assert.rejects(
    () => repo.create(makeRecord({ runId: 'run-3', clientRequestId: 'c2' })),
    (error: unknown) => error instanceof RefinementRunConflictError && error.kind === 'active_run',
    `${label}: 已有 queued run 应冲突`
  );

  // 其他创建者/其他章节互不影响
  await repo.create(makeRecord({ runId: 'run-4', clientRequestId: 'c3', creatorId: 'u2' }));
  await repo.create(
    makeRecord({ runId: 'run-5', clientRequestId: 'c4', chapterNo: 2, projectId: 'p2' })
  );

  // findActive 只认 queued/running
  const active = await repo.findActive('p1', 1, 'u1');
  assert.equal(active?.runId, 'run-1');

  const byClient = await repo.findByClientRequestId('u1', 'c1');
  assert.equal(byClient?.runId, 'run-1');

  // CAS：revision 失配拒绝写入
  const stale = await repo.save(makeRecord({ status: 'ready', revision: 2 }), 99);
  assert.equal(stale, undefined, `${label}: revision 失配应拒绝`);

  // CAS：匹配时写入并推进 revision
  const saved = await repo.save(makeRecord({ status: 'ready', revision: 2 }), 1);
  assert.ok(saved, `${label}: revision 匹配应写入`);
  const reloaded = await repo.getById('run-1');
  assert.equal(reloaded?.status, 'ready');
  assert.equal(reloaded?.revision, 2);

  // 终态后不再是活动 run
  assert.equal(await repo.findActive('p1', 1, 'u1'), undefined);

  // 列表按创建时间倒序，且只含本人本项目的记录
  await repo.create(
    makeRecord({
      runId: 'run-6',
      clientRequestId: 'c5',
      createdAt: '2026-10-06T01:00:00.000Z',
      updatedAt: '2026-10-06T01:00:00.000Z',
    })
  );
  const list = await repo.listByCreator('p1', 1, 'u1', 10);
  assert.deepEqual(
    list.map((item) => item.runId),
    ['run-6', 'run-1'],
    `${label}: 列表应最新优先`
  );
  assert.equal((await repo.listByCreator('p1', 1, 'u1', 1)).length, 1);

  // 5.1：按状态批量查询（重启恢复扫描）
  const queued = await repo.listByStatuses(['queued', 'running']);
  assert.deepEqual(
    queued.map((item) => item.runId).sort(),
    ['run-4', 'run-5', 'run-6'],
    `${label}: listByStatuses 应只返回指定状态`
  );
  assert.equal((await repo.listByStatuses([])).length, 0, `${label}: 空状态不返回记录`);

  // 5.1：过期扫描（expiresAt 早于给定时刻）；active 记录用远期 expiresAt 不会被命中
  const expired = await repo.listExpired('2026-10-14T00:00:00.000Z');
  assert.equal(expired.length, 4, `${label}: listExpired 应命中全部到期记录`);
  assert.equal(
    (await repo.listExpired('2026-10-01T00:00:00.000Z')).length,
    0,
    `${label}: 未到期不应命中`
  );

  // 5.1：墓碑二次到期彻底删除
  await repo.remove('run-6');
  assert.equal(await repo.getById('run-6'), undefined, `${label}: remove 应删除记录`);

  await repo.clearForTest();
}

test('内存仓库满足 run 仓库契约', async () => {
  await runRepositoryContract(new MapChapterRefinementRunRepository(), 'memory');
});

const PG_TEST_URL = process.env.REFINEMENT_PG_TEST_URL?.trim();

test(
  'PG 仓库在真实临时 schema 上完成迁移与 round-trip',
  { skip: PG_TEST_URL ? false : 'REFINEMENT_PG_TEST_URL 未配置，跳过真实 PG 往返' },
  async () => {
    // W1：PgChapterRefinementRunRepository 与 RefinementRunConflictError 必须来自**同一模块实例**，
    // 否则 tsx/Node 下静态 import 与动态 import 会解析成两份类，`instanceof` 恒为 false。
    // 这里统一走顶部静态 import（该仓库文件本就静态依赖 PrismaService → @prisma/client），
    // 仅对运行期才需要的 PrismaClient 用动态 import。
    const { PrismaClient } = await import('@prisma/client');

    const schema = `refinement_test_${Date.now().toString(36)}`;
    const admin = new PrismaClient({ datasources: { db: { url: PG_TEST_URL } } });
    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

      const scopedUrl = appendSchema(PG_TEST_URL!, schema);
      const scoped = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
      try {
        const migrationSql = readFileSync(
          path.resolve(
            __dirname,
            '../../../prisma/migrations/20261006120000_aq380_chapter_refinement_runs/migration.sql'
          ),
          'utf8'
        );
        for (const statement of splitSqlStatements(migrationSql)) {
          await scoped.$executeRawUnsafe(statement);
        }

        // 迁移必须真正建出部分唯一索引（单活动 run 的 PG 侧保障）
        const indexRows = await scoped.$queryRawUnsafe<Array<{ indexname: string }>>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'chapter_refinement_runs'`,
          schema
        );
        const indexNames = indexRows.map((row) => row.indexname);
        assert.ok(indexNames.includes('chapter_refinement_runs_active_uidx'));
        assert.ok(indexNames.includes('chapter_refinement_runs_creator_client_uidx'));

        const repo = new PgChapterRefinementRunRepository(
          scoped as unknown as ConstructorParameters<typeof PgChapterRefinementRunRepository>[0]
        );
        await runRepositoryContract(repo, 'postgres');

        // 部分唯一索引只拦 queued/running：终态后同章可再次创建
        await repo.create(makeRecord({ runId: 'run-7', clientRequestId: 'c6' }));
        assert.equal((await repo.listByCreator('p1', 1, 'u1', 10)).length, 1);
        const settled = await repo.save(
          makeRecord({ runId: 'run-7', status: 'ready', revision: 2 }),
          1
        );
        assert.ok(settled, 'postgres: run-7 应从 queued 推进到 ready');
        await repo.create(makeRecord({ runId: 'run-8', clientRequestId: 'c7' }));
        assert.equal((await repo.listByCreator('p1', 1, 'u1', 10)).length, 2);
      } finally {
        await scoped.$disconnect();
      }
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }
);

function appendSchema(url: string, schema: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}schema=${schema}`;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
