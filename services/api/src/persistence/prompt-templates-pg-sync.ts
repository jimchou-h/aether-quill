import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  TemplateRecord,
  TemplateVersion,
} from '../modules/prompt-templates/prompt-templates.entity';

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

export async function syncPromptTemplatesToPostgres(
  prisma: PrismaClient,
  payload: PersistedPromptTemplatesPayload
): Promise<void> {
  const keys = payload.templates.map((t) => ({ projectId: t.projectId, id: t.id }));
  if (keys.length === 0) {
    await prisma.promptTemplateVersion.deleteMany();
    await prisma.promptTemplate.deleteMany();
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

      await tx.promptTemplateVersion.deleteMany({
        where: { projectId: t.projectId, templateId: t.id },
      });
      const vers = payload.versions[t.id] ?? [];
      if (vers.length > 0) {
        await tx.promptTemplateVersion.createMany({
          data: vers.map((v) => ({
            id: randomUUID(),
            templateId: t.id,
            projectId: t.projectId,
            version: v.version,
            content: v.content,
            isPublished: v.isPublished,
            createdAt: new Date(v.createdAt),
          })),
        });
      }
    }
  });
}
