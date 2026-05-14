import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ChunkRecord,
  DocumentRecord,
  DocumentVersion,
} from '../modules/documents/documents.entity';

export interface PersistedDocumentsPayload {
  documents: Array<{
    id: string;
    projectId: string;
    title: string;
    content: string;
    indexStatus: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  versions: Record<
    string,
    Array<{ version: number; title: string; content: string; createdAt: string }>
  >;
  chunks: Record<
    string,
    Array<{
      id: string;
      documentId: string;
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>
  >;
}

export interface RestoredDocumentsState {
  documents: DocumentRecord[];
  versions: Record<string, DocumentVersion[]>;
  chunks: Record<string, ChunkRecord[]>;
}

export async function loadDocumentsFromPostgres(
  prisma: PrismaClient
): Promise<RestoredDocumentsState | null> {
  const count = await prisma.document.count();
  if (count === 0) {
    return null;
  }

  const docs = await prisma.document.findMany({
    include: {
      versions: { orderBy: { version: 'asc' } },
      chunks: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const documents: DocumentRecord[] = docs.map((d) => ({
    id: d.id,
    projectId: d.projectId,
    title: d.title,
    content: d.content,
    indexStatus: d.indexStatus as DocumentRecord['indexStatus'],
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));

  const versions: Record<string, DocumentVersion[]> = {};
  const chunks: Record<string, ChunkRecord[]> = {};

  for (const d of docs) {
    versions[d.id] = d.versions.map((v) => ({
      version: v.version,
      title: v.title,
      content: v.content,
      createdAt: v.createdAt,
    }));
    chunks[d.id] = d.chunks.map((c) => ({
      id: c.id,
      documentId: c.documentId,
      content: c.content,
      metadata: (c.metadata as Record<string, unknown>) ?? {},
      createdAt: c.createdAt,
    }));
  }

  return { documents, versions, chunks };
}

export async function syncDocumentsToPostgres(
  prisma: PrismaClient,
  payload: PersistedDocumentsPayload
): Promise<void> {
  const docIds = payload.documents.map((d) => d.id);
  if (docIds.length === 0) {
    await prisma.docChunk.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.deleteMany({
      where: { id: { notIn: docIds } },
    });

    for (const d of payload.documents) {
      await tx.document.upsert({
        where: { id: d.id },
        create: {
          id: d.id,
          projectId: d.projectId,
          title: d.title,
          content: d.content,
          indexStatus: d.indexStatus,
          version: d.version,
          createdAt: new Date(d.createdAt),
          updatedAt: new Date(d.updatedAt),
        },
        update: {
          projectId: d.projectId,
          title: d.title,
          content: d.content,
          indexStatus: d.indexStatus,
          version: d.version,
          updatedAt: new Date(d.updatedAt),
        },
      });

      await tx.documentVersion.deleteMany({ where: { documentId: d.id } });
      const vers = payload.versions[d.id] ?? [];
      if (vers.length > 0) {
        await tx.documentVersion.createMany({
          data: vers.map((v) => ({
            id: randomUUID(),
            documentId: d.id,
            version: v.version,
            title: v.title,
            content: v.content,
            createdAt: new Date(v.createdAt),
          })),
        });
      }

      await tx.docChunk.deleteMany({ where: { documentId: d.id } });
      const chs = payload.chunks[d.id] ?? [];
      if (chs.length > 0) {
        await tx.docChunk.createMany({
          data: chs.map((c) => ({
            id: c.id,
            documentId: d.id,
            content: c.content,
            metadata: c.metadata as Prisma.InputJsonValue,
            createdAt: new Date(c.createdAt),
          })),
        });
      }
    }
  });
}
