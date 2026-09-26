import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  TemplateRecord,
  TemplateVersion,
} from '../modules/prompt-templates/prompt-templates.entity';

/** 模板版本正文很长，整表 wipe+重写会超过 Prisma 默认 5s 事务。 */
export const PROMPT_TEMPLATES_PG_TX_OPTIONS = {
  maxWait: 30_000,
  timeout: 60_000,
} as const;

const VERSION_CREATE_BATCH_SIZE = 20;

type IncomingPromptTemplateVersion = {
  version: number;
  content: string;
  createdAt: string;
  isPublished: boolean;
};

export function planPromptTemplateVersionWrites(input: {
  existing: Array<{ version: number; isPublished: boolean }>;
  incoming: IncomingPromptTemplateVersion[];
}): {
  toInsert: IncomingPromptTemplateVersion[];
  needRepublish: boolean;
  publishedVersions: number[];
} {
  const existingByVersion = new Map(input.existing.map((row) => [row.version, row]));
  const toInsert = input.incoming.filter((row) => !existingByVersion.has(row.version));
  const incomingPublished = input.incoming
    .filter((row) => row.isPublished)
    .map((row) => row.version)
    .sort((a, b) => a - b);
  const existingPublished = input.existing
    .filter((row) => row.isPublished)
    .map((row) => row.version)
    .sort((a, b) => a - b);
  const needRepublish =
    incomingPublished.length !== existingPublished.length ||
    incomingPublished.some((version, index) => version !== existingPublished[index]);
  return { toInsert, needRepublish, publishedVersions: incomingPublished };
}

async function createManyInBatches<T>(
  rows: T[],
  batchSize: number,
  createBatch: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let index = 0; index < rows.length; index += batchSize) {
    await createBatch(rows.slice(index, index + batchSize));
  }
}

export interface PersistedPromptTemplatesPayload {
  templates: Array<{
    id: string;
    projectId: string;
    name: string;
    category: string;
    content: string;
    version: number;
    isPublished: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  versions: Record<
    string,
    Array<{ version: number; content: string; createdAt: string; isPublished: boolean }>
  >;
}

export interface RestoredPromptTemplatesState {
  templates: TemplateRecord[];
  versions: Record<string, TemplateVersion[]>;
}

export async function loadPromptTemplatesFromPostgres(
  prisma: PrismaClient
): Promise<RestoredPromptTemplatesState | null> {
  const count = await prisma.promptTemplate.count();
  if (count === 0) {
    return null;
  }

  const rows = await prisma.promptTemplate.findMany({
    include: {
      versions: { orderBy: { version: 'asc' } },
    },
    orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
  });

  const templates: TemplateRecord[] = rows.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    category: t.category as TemplateRecord['category'],
    content: t.content,
    version: t.version,
    isPublished: t.isPublished,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  const versions: Record<string, TemplateVersion[]> = {};
  for (const t of rows) {
    versions[t.id] = t.versions.map((v) => ({
      version: v.version,
      content: v.content,
      createdAt: v.createdAt,
      isPublished: v.isPublished,
    }));
  }

  return { templates, versions };
}

/** 内存快照明显小于库里已有行时拒绝整表覆盖，避免空 hydrate + initDefaults 冲掉全部模板。 */
export function shouldReplacePromptTemplateSnapshot(input: {
  existingCount: number;
  incomingCount: number;
}): boolean {
  if (input.incomingCount === 0 && input.existingCount > 0) {
    return false;
  }
  if (input.existingCount >= 6 && input.incomingCount < input.existingCount - 3) {
    return false;
  }
  return true;
}

export async function syncPromptTemplatesToPostgres(
  prisma: PrismaClient,
  payload: PersistedPromptTemplatesPayload
): Promise<void> {
  const keys = payload.templates.map((t) => ({ projectId: t.projectId, id: t.id }));
  const existingCount = await prisma.promptTemplate.count();
  if (!shouldReplacePromptTemplateSnapshot({ existingCount, incomingCount: keys.length })) {
    console.error(
      `[persistence] 拒绝 prompt-templates 整表覆盖 existing=${existingCount} incoming=${keys.length}`
    );
    return;
  }
  if (keys.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const keepPairs = new Set(keys.map((k) => `${k.projectId}\t${k.id}`));
    const all = await tx.promptTemplate.findMany({ select: { projectId: true, id: true } });
    const stale = all.filter((r) => !keepPairs.has(`${r.projectId}\t${r.id}`));
    for (const s of stale) {
      await tx.promptTemplate.delete({
        where: { projectId_id: { projectId: s.projectId, id: s.id } },
      });
    }

    for (const t of payload.templates) {
      await tx.promptTemplate.upsert({
        where: { projectId_id: { projectId: t.projectId, id: t.id } },
        create: {
          id: t.id,
          projectId: t.projectId,
          name: t.name,
          category: t.category,
          content: t.content,
          version: t.version,
          isPublished: t.isPublished,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        },
        update: {
          name: t.name,
          category: t.category,
          content: t.content,
          version: t.version,
          isPublished: t.isPublished,
          updatedAt: new Date(t.updatedAt),
        },
      });

      const vers = payload.versions[t.id] ?? [];
      if (vers.length === 0) {
        continue;
      }
      const existingVers = await tx.promptTemplateVersion.findMany({
        where: { projectId: t.projectId, templateId: t.id },
        select: { version: true, isPublished: true },
      });
      const plan = planPromptTemplateVersionWrites({
        existing: existingVers,
        incoming: vers,
      });
      if (plan.toInsert.length > 0) {
        await createManyInBatches(plan.toInsert, VERSION_CREATE_BATCH_SIZE, (batch) =>
          tx.promptTemplateVersion.createMany({
            data: batch.map((v) => ({
              id: randomUUID(),
              templateId: t.id,
              projectId: t.projectId,
              version: v.version,
              content: v.content,
              isPublished: v.isPublished,
              createdAt: new Date(v.createdAt),
            })),
          })
        );
      }
      if (plan.needRepublish) {
        await tx.promptTemplateVersion.updateMany({
          where: { projectId: t.projectId, templateId: t.id },
          data: { isPublished: false },
        });
        if (plan.publishedVersions.length > 0) {
          await tx.promptTemplateVersion.updateMany({
            where: {
              projectId: t.projectId,
              templateId: t.id,
              version: { in: plan.publishedVersions },
            },
            data: { isPublished: true },
          });
        }
      }
    }
  }, PROMPT_TEMPLATES_PG_TX_OPTIONS);
}
