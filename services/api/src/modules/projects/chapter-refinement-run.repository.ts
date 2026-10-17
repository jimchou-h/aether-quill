/**
 * 章节精修 run 仓库（AQ-380）。
 *
 * 两个实现共享同一套约束语义，便于测试断言一致性：
 *  - 幂等键 (creatorId, clientRequestId) 唯一；
 *  - 同项目 + 章节 + 创建者同时最多一个 queued/running；
 *  - 写入按 revision 做 CAS，避免迟到回调覆写新尝试。
 *
 * PG 使用独立表，避免每个 token 重写 workspace JSON；未配置 DATABASE_URL 时用进程 Map。
 */

import { PrismaService } from '../../prisma/prisma.service';
import { usePostgresPersistence } from '../../persistence/use-postgres';
import {
  isRefinementActiveStatus,
  type RefinementRunRecord,
  type RefinementStatus,
  type RefinementStorageMode,
} from './chapter-refinement.types';

export type RefinementRunConflictKind = 'active_run' | 'idempotency_key';

export class RefinementRunConflictError extends Error {
  constructor(
    readonly kind: RefinementRunConflictKind,
    message: string
  ) {
    super(message);
    this.name = 'RefinementRunConflictError';
  }
}

export interface ChapterRefinementRunRepository {
  readonly storageMode: RefinementStorageMode;
  /** 违反幂等键或单活动 run 约束时抛 {@link RefinementRunConflictError} */
  create(record: RefinementRunRecord): Promise<RefinementRunRecord>;
  getById(runId: string): Promise<RefinementRunRecord | undefined>;
  findByClientRequestId(
    creatorId: string,
    clientRequestId: string
  ): Promise<RefinementRunRecord | undefined>;
  findActive(
    projectId: string,
    chapterNo: number,
    creatorId: string
  ): Promise<RefinementRunRecord | undefined>;
  listByCreator(
    projectId: string,
    chapterNo: number,
    creatorId: string,
    limit: number
  ): Promise<RefinementRunRecord[]>;
  /** 5.1：按状态批量查询（重启恢复扫描 queued/running）。 */
  listByStatuses(statuses: readonly RefinementStatus[]): Promise<RefinementRunRecord[]>;
  /** 5.1：列出 expiresAt <= now 的记录（TTL 清理；active 记录 expiresAt 为远期，天然排除）。 */
  listExpired(nowIso: string): Promise<RefinementRunRecord[]>;
  /** 5.1：墓碑二次到期后彻底删除。 */
  remove(runId: string): Promise<void>;
  /** CAS：仅当存储 revision 等于 expectedRevision 时写入；失配返回 undefined */
  save(
    record: RefinementRunRecord,
    expectedRevision: number
  ): Promise<RefinementRunRecord | undefined>;
  clearForTest(): Promise<void>;
}

function isUniqueViolation(error: unknown): { constraint: string } | null {
  const err = error as { code?: string; meta?: { target?: unknown } };
  if (!err || err.code !== 'P2002') {
    return null;
  }
  const target = err.meta?.target;
  const constraint = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return { constraint };
}

export class PgChapterRefinementRunRepository implements ChapterRefinementRunRepository {
  readonly storageMode: RefinementStorageMode = 'postgres';

  constructor(private readonly prisma: PrismaService) {}

  async create(record: RefinementRunRecord): Promise<RefinementRunRecord> {
    try {
      await this.prisma.chapterRefinementRun.create({
        data: {
          id: record.runId,
          projectId: record.projectId,
          chapterNo: record.chapterNo,
          creatorId: record.creatorId,
          clientRequestId: record.clientRequestId,
          payloadHash: record.payloadHash,
          status: record.status,
          phase: record.phase,
          revision: record.revision,
          attemptId: record.attemptId,
          pauseReason: record.pauseReason,
          resumable: record.resumable,
          baseUpdatedAt: new Date(record.baseUpdatedAt),
          baseHash: record.baseHash,
          rewritePolicy: record.rewritePolicy,
          snapshotJson: record.snapshot as unknown as object,
          checkpointJson: record.checkpoint as unknown as object,
          tombstone: record.tombstone,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
          expiresAt: new Date(record.expiresAt),
        },
      });
      return record;
    } catch (error) {
      const violation = isUniqueViolation(error);
      if (violation) {
        if (violation.constraint.includes('client_request_id')) {
          throw new RefinementRunConflictError('idempotency_key', 'clientRequestId 已被使用');
        }
        throw new RefinementRunConflictError('active_run', '该章节已有进行中的智能精修');
      }
      throw error;
    }
  }

  async getById(runId: string): Promise<RefinementRunRecord | undefined> {
    const row = await this.prisma.chapterRefinementRun.findUnique({ where: { id: runId } });
    return row ? toRecord(row) : undefined;
  }

  async findByClientRequestId(
    creatorId: string,
    clientRequestId: string
  ): Promise<RefinementRunRecord | undefined> {
    const row = await this.prisma.chapterRefinementRun.findUnique({
      where: { creatorId_clientRequestId: { creatorId, clientRequestId } },
    });
    return row ? toRecord(row) : undefined;
  }

  async findActive(
    projectId: string,
    chapterNo: number,
    creatorId: string
  ): Promise<RefinementRunRecord | undefined> {
    const row = await this.prisma.chapterRefinementRun.findFirst({
      where: {
        projectId,
        chapterNo,
        creatorId,
        status: { in: ['queued', 'running'] },
      },
    });
    return row ? toRecord(row) : undefined;
  }

  async listByCreator(
    projectId: string,
    chapterNo: number,
    creatorId: string,
    limit: number
  ): Promise<RefinementRunRecord[]> {
    const rows = await this.prisma.chapterRefinementRun.findMany({
      where: { projectId, chapterNo, creatorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async listByStatuses(statuses: readonly RefinementStatus[]): Promise<RefinementRunRecord[]> {
    if (statuses.length === 0) {
      return [];
    }
    const rows = await this.prisma.chapterRefinementRun.findMany({
      where: { status: { in: [...statuses] } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async listExpired(nowIso: string): Promise<RefinementRunRecord[]> {
    const rows = await this.prisma.chapterRefinementRun.findMany({
      where: { expiresAt: { lte: new Date(nowIso) } },
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async remove(runId: string): Promise<void> {
    await this.prisma.chapterRefinementRun.deleteMany({ where: { id: runId } });
  }

  async save(
    record: RefinementRunRecord,
    expectedRevision: number
  ): Promise<RefinementRunRecord | undefined> {
    const result = await this.prisma.chapterRefinementRun.updateMany({
      where: { id: record.runId, revision: expectedRevision },
      data: {
        status: record.status,
        phase: record.phase,
        revision: record.revision,
        attemptId: record.attemptId,
        pauseReason: record.pauseReason,
        resumable: record.resumable,
        snapshotJson: record.snapshot as unknown as object,
        checkpointJson: record.checkpoint as unknown as object,
        tombstone: record.tombstone,
        updatedAt: new Date(record.updatedAt),
        expiresAt: new Date(record.expiresAt),
      },
    });
    return result.count === 1 ? record : undefined;
  }

  async clearForTest(): Promise<void> {
    await this.prisma.chapterRefinementRun.deleteMany({});
  }
}

interface MapEntry {
  record: RefinementRunRecord;
}

export class MapChapterRefinementRunRepository implements ChapterRefinementRunRepository {
  readonly storageMode: RefinementStorageMode = 'memory';

  private readonly byId = new Map<string, MapEntry>();

  async create(record: RefinementRunRecord): Promise<RefinementRunRecord> {
    for (const entry of this.byId.values()) {
      if (
        entry.record.creatorId === record.creatorId &&
        entry.record.clientRequestId === record.clientRequestId
      ) {
        throw new RefinementRunConflictError('idempotency_key', 'clientRequestId 已被使用');
      }
      if (
        entry.record.projectId === record.projectId &&
        entry.record.chapterNo === record.chapterNo &&
        entry.record.creatorId === record.creatorId &&
        isRefinementActiveStatus(entry.record.status)
      ) {
        throw new RefinementRunConflictError('active_run', '该章节已有进行中的智能精修');
      }
    }
    this.byId.set(record.runId, { record: cloneRecord(record) });
    return cloneRecord(record);
  }

  async getById(runId: string): Promise<RefinementRunRecord | undefined> {
    const entry = this.byId.get(runId);
    return entry ? cloneRecord(entry.record) : undefined;
  }

  async findByClientRequestId(
    creatorId: string,
    clientRequestId: string
  ): Promise<RefinementRunRecord | undefined> {
    for (const entry of this.byId.values()) {
      if (
        entry.record.creatorId === creatorId &&
        entry.record.clientRequestId === clientRequestId
      ) {
        return cloneRecord(entry.record);
      }
    }
    return undefined;
  }

  async findActive(
    projectId: string,
    chapterNo: number,
    creatorId: string
  ): Promise<RefinementRunRecord | undefined> {
    for (const entry of this.byId.values()) {
      const { record } = entry;
      if (
        record.projectId === projectId &&
        record.chapterNo === chapterNo &&
        record.creatorId === creatorId &&
        isRefinementActiveStatus(record.status)
      ) {
        return cloneRecord(record);
      }
    }
    return undefined;
  }

  async listByCreator(
    projectId: string,
    chapterNo: number,
    creatorId: string,
    limit: number
  ): Promise<RefinementRunRecord[]> {
    return Array.from(this.byId.values())
      .map((entry) => entry.record)
      .filter(
        (record) =>
          record.projectId === projectId &&
          record.chapterNo === chapterNo &&
          record.creatorId === creatorId
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
      .map(cloneRecord);
  }

  async listByStatuses(statuses: readonly RefinementStatus[]): Promise<RefinementRunRecord[]> {
    if (statuses.length === 0) {
      return [];
    }
    const wanted = new Set(statuses);
    return Array.from(this.byId.values())
      .map((entry) => entry.record)
      .filter((record) => wanted.has(record.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map(cloneRecord);
  }

  async listExpired(nowIso: string): Promise<RefinementRunRecord[]> {
    return Array.from(this.byId.values())
      .map((entry) => entry.record)
      .filter((record) => record.expiresAt <= nowIso)
      .sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1))
      .map(cloneRecord);
  }

  async remove(runId: string): Promise<void> {
    this.byId.delete(runId);
  }

  async save(
    record: RefinementRunRecord,
    expectedRevision: number
  ): Promise<RefinementRunRecord | undefined> {
    const entry = this.byId.get(record.runId);
    if (!entry || entry.record.revision !== expectedRevision) {
      return undefined;
    }
    entry.record = cloneRecord(record);
    return cloneRecord(record);
  }

  async clearForTest(): Promise<void> {
    this.byId.clear();
  }
}

export function createChapterRefinementRunRepository(
  prisma: PrismaService
): ChapterRefinementRunRepository {
  return usePostgresPersistence()
    ? new PgChapterRefinementRunRepository(prisma)
    : new MapChapterRefinementRunRepository();
}

export const CHAPTER_REFINEMENT_RUN_REPOSITORY = Symbol('CHAPTER_REFINEMENT_RUN_REPOSITORY');

function cloneRecord(record: RefinementRunRecord): RefinementRunRecord {
  return structuredClone(record);
}

interface PrismaRunRow {
  id: string;
  projectId: string;
  chapterNo: number;
  creatorId: string;
  clientRequestId: string;
  payloadHash: string;
  status: string;
  phase: string;
  revision: number;
  attemptId: string | null;
  pauseReason: string | null;
  resumable: boolean;
  baseUpdatedAt: Date;
  baseHash: string;
  rewritePolicy: string;
  snapshotJson: unknown;
  checkpointJson: unknown;
  tombstone: boolean;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

function toRecord(row: PrismaRunRow): RefinementRunRecord {
  return {
    runId: row.id,
    projectId: row.projectId,
    chapterNo: row.chapterNo,
    creatorId: row.creatorId,
    clientRequestId: row.clientRequestId,
    payloadHash: row.payloadHash,
    status: row.status as RefinementRunRecord['status'],
    phase: row.phase as RefinementRunRecord['phase'],
    revision: row.revision,
    attemptId: row.attemptId,
    pauseReason: row.pauseReason as RefinementRunRecord['pauseReason'],
    resumable: row.resumable,
    baseUpdatedAt: row.baseUpdatedAt.toISOString(),
    baseHash: row.baseHash,
    rewritePolicy: row.rewritePolicy as RefinementRunRecord['rewritePolicy'],
    snapshot: row.snapshotJson as RefinementRunRecord['snapshot'],
    checkpoint: row.checkpointJson as RefinementRunRecord['checkpoint'],
    tombstone: row.tombstone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
