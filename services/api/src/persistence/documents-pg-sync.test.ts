import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedDocumentsPayload } from './documents-pg-sync';
import { syncDocumentsToPostgres, syncSingleDocumentToPostgres } from './documents-pg-sync';

function samplePayload(): PersistedDocumentsPayload {
  return {
    documents: [
      {
        id: 'doc-a',
        projectId: 'p1',
        title: 'A',
        content: 'content-a',
        docType: 'persona_card',
        personaId: 'persona-1',
        indexStatus: 'ready',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'doc-b',
        projectId: 'p1',
        title: 'B',
        content: 'content-b',
        docType: 'worldview',
        personaId: null,
        indexStatus: 'ready',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    versions: {
      'doc-a': [
        {
          version: 1,
          title: 'A',
          content: 'content-a',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      'doc-b': [
        {
          version: 1,
          title: 'B',
          content: 'content-b',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    chunks: {
      'doc-a': [
        {
          id: 'chunk-a',
          documentId: 'doc-a',
          content: 'chunk-a',
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      'doc-b': [
        {
          id: 'chunk-b',
          documentId: 'doc-b',
          content: 'chunk-b',
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  };
}

function createRecordingPrisma() {
  const chunkDeletes: string[] = [];
  const versionDeletes: string[] = [];
  const upserted: string[] = [];

  const tx = {
    document: {
      async upsert(args: { where: { id: string } }) {
        upserted.push(args.where.id);
      },
      async deleteMany() {
        return { count: 0 };
      },
      async count() {
        return 2;
      },
    },
    documentVersion: {
      async deleteMany(args: { where: { documentId: string } }) {
        versionDeletes.push(args.where.documentId);
      },
      async createMany() {
        return { count: 0 };
      },
    },
    docChunk: {
      async deleteMany(args: { where: { documentId: string } }) {
        chunkDeletes.push(args.where.documentId);
      },
      async createMany() {
        return { count: 0 };
      },
    },
  };

  const prisma = {
    document: {
      async count() {
        return 2;
      },
    },
    async $transaction(fn: (client: typeof tx) => Promise<void>) {
      await fn(tx);
    },
  };

  return { prisma, chunkDeletes, versionDeletes, upserted };
}

test('syncSingleDocumentToPostgres only rewrites target document chunks', async () => {
  const { prisma, chunkDeletes, versionDeletes, upserted } = createRecordingPrisma();
  await syncSingleDocumentToPostgres(prisma as never, samplePayload(), 'doc-a');

  assert.deepEqual(upserted, ['doc-a']);
  assert.deepEqual(versionDeletes, ['doc-a']);
  assert.deepEqual(chunkDeletes, ['doc-a']);
  assert.equal(chunkDeletes.includes('doc-b'), false);
});

test('syncDocumentsToPostgres still rewrites every document in payload', async () => {
  const { prisma, chunkDeletes } = createRecordingPrisma();
  await syncDocumentsToPostgres(prisma as never, samplePayload());
  assert.deepEqual(chunkDeletes.sort(), ['doc-a', 'doc-b']);
});

test('syncDocumentsToPostgres refuses empty snapshot when PG has rows', async () => {
  const { prisma } = createRecordingPrisma();
  await assert.rejects(
    () =>
      syncDocumentsToPostgres(prisma as never, {
        documents: [],
        versions: {},
        chunks: {},
      }),
    /Refusing to wipe/
  );
});
