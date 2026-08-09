import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ChunkRecord,
  DocumentRecord,
  DocumentVersion,
} from '../modules/documents/documents.entity';
import { normalizeDocType } from '../modules/documents/documents-type.util';

/** 文档全量同步（含版本史与 chunk，体积可能很大） */
export const DOCUMENTS_PG_FULL_TX_OPTIONS = {
  maxWait: 30_000,
  timeout: 300_000,
} as const;

const DOCUMENT_CREATE_MANY_BATCH_SIZE = 40;

async function createManyInBatches<T>(
  rows: T[],
  batchSize: number,
  createBatch: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let index = 0; index < rows.length; index += batchSize) {
    await createBatch(rows.slice(index, index + batchSize));
  }
}

export interface PersistedDocumentsPayload {
  documents: Array<{
    id: string;
    projectId: string;
    title: string;
    content: string;
    docType?: string;
    personaId?: string | null;
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
    docType: normalizeDocType(d.docType),
    personaId: (d as { personaId?: string | null }).personaId ?? null,
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
    // 禁止用空内存快照清空 PG：启动失败/半初始化时 fire-and-forget 同步会误删全库
    const existing = await prisma.document.count();
    if (existing > 0) {
      console.error(
        `[persistence] 拒绝空 documents 快照覆盖 PG（库内仍有 ${existing} 篇文档）`
      );
      throw new Error('Refusing to wipe non-empty documents table with empty in-memory snapshot');
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.deleteMany({
      where: { id: { notIn: docIds } },
    });

    for (const d of payload.documents) {
      await upsertDocumentGraph(tx, payload, d.id);
    }
  }, DOCUMENTS_PG_FULL_TX_OPTIONS);
}

/** 单文档增量同步：不触碰无关文档的 versions/chunks */
export async function syncSingleDocumentToPostgres(
  prisma: PrismaClient,
  payload: PersistedDocumentsPayload,
  documentId: string
): Promise<void> {
  const doc = payload.documents.find((item) => item.id === documentId);
  if (!doc) {
    throw new Error(`syncSingleDocumentToPostgres: document not in payload: ${documentId}`);
  }

  await prisma.$transaction(async (tx) => {
    await upsertDocumentGraph(tx, payload, documentId);
  }, DOCUMENTS_PG_FULL_TX_OPTIONS);
}

/** 从 PG 删除单篇文档（版本/chunk 依赖 DB cascade 或显式清理） */
export async function deleteDocumentFromPostgres(
  prisma: PrismaClient,
  documentId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.docChunk.deleteMany({ where: { documentId } });
    await tx.documentVersion.deleteMany({ where: { documentId } });
    await tx.document.deleteMany({ where: { id: documentId } });
  }, DOCUMENTS_PG_FULL_TX_OPTIONS);
}

type PgTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function upsertDocumentGraph(
  tx: PgTx,
  payload: PersistedDocumentsPayload,
  documentId: string
): Promise<void> {
  const d = payload.documents.find((item) => item.id === documentId);
  if (!d) {
    throw new Error(`upsertDocumentGraph: missing document ${documentId}`);
  }

  await tx.document.upsert({
    where: { id: d.id },
    create: {
      id: d.id,
      projectId: d.projectId,
      title: d.title,
      content: d.content,
      docType: normalizeDocType(d.docType),
      personaId: d.personaId ?? null,
      indexStatus: d.indexStatus,
      version: d.version,
      createdAt: new Date(d.createdAt),
      updatedAt: new Date(d.updatedAt),
    },
    update: {
      projectId: d.projectId,
      title: d.title,
      content: d.content,
      docType: normalizeDocType(d.docType),
      personaId: d.personaId ?? null,
      indexStatus: d.indexStatus,
      version: d.version,
      updatedAt: new Date(d.updatedAt),
    },
  });

  await tx.documentVersion.deleteMany({ where: { documentId: d.id } });
  const vers = payload.versions[d.id] ?? [];
  if (vers.length > 0) {
    const versionRows = vers.map((v) => ({
      id: randomUUID(),
      documentId: d.id,
      version: v.version,
      title: v.title,
      content: v.content,
      createdAt: new Date(v.createdAt),
    }));
    await createManyInBatches(versionRows, DOCUMENT_CREATE_MANY_BATCH_SIZE, (batch) =>
      tx.documentVersion.createMany({ data: batch })
    );
  }

  await tx.docChunk.deleteMany({ where: { documentId: d.id } });
  const chs = payload.chunks[d.id] ?? [];
  if (chs.length > 0) {
    const chunkRows = chs.map((c) => ({
      id: c.id,
      documentId: d.id,
      content: c.content,
      metadata: c.metadata as Prisma.InputJsonValue,
      createdAt: new Date(c.createdAt),
    }));
    await createManyInBatches(chunkRows, DOCUMENT_CREATE_MANY_BATCH_SIZE, (batch) =>
      tx.docChunk.createMany({ data: batch })
    );
  }
}
