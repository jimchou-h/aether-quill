import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import axios from 'axios';
import { ProjectsService } from '../projects/projects.service';
import { listDocumentIdsForProject } from '../projects/project-delete.util';
import {
  DocumentRecord,
  ChunkRecord,
  DocumentVersion,
  ReindexResult,
  IndexStatus,
  CommitIndexResultInput,
} from './documents.entity';
import { PrismaService } from '../../prisma/prisma.service';
import { usePostgresPersistence } from '../../persistence/use-postgres';
import {
  loadDocumentsFromPostgres,
  syncDocumentsToPostgres,
  type PersistedDocumentsPayload,
  type RestoredDocumentsState,
} from '../../persistence/documents-pg-sync';

interface PersistedDocumentState {
  documents: Array<{
    id: string;
    projectId: string;
    title: string;
    content: string;
    indexStatus: IndexStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
  }>;
  versions: Record<
    string,
    Array<{
      version: number;
      title: string;
      content: string;
      createdAt: string;
    }>
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

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly storagePath = join(resolve(process.cwd()), 'data', 'documents.json');

  private readonly documents: DocumentRecord[] = [];
  private readonly versions = new Map<string, DocumentVersion[]>();
  private readonly chunks = new Map<string, ChunkRecord[]>();

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly prisma: PrismaService
  ) {
    if (usePostgresPersistence()) {
      return;
    }
    const restored = this.restoreStateFromDisk();
    if (restored) {
      this.applyRestored(restored);
    }
  }

  async onModuleInit() {
    await this.projectsService.persistenceReady;
    if (!usePostgresPersistence()) {
      return;
    }
    try {
      const fromPg = await loadDocumentsFromPostgres(this.prisma);
      if (fromPg) {
        this.applyRestored(fromPg);
      } else {
        const fromJson = this.restoreStateFromDisk();
        if (fromJson) {
          this.applyRestored(fromJson);
          await syncDocumentsToPostgres(this.prisma, this.buildPersistedPayload());
        }
      }
    } catch (err) {
      console.error('[persistence] documents PG 初始化失败', err);
      const fromJson = this.restoreStateFromDisk();
      if (fromJson) {
        this.applyRestored(fromJson);
      }
    }
  }

  private applyRestored(restored: RestoredDocumentsState) {
    this.documents.splice(0, this.documents.length, ...restored.documents);
    this.versions.clear();
    this.chunks.clear();
    this.hydrateMap(this.versions, restored.versions);
    this.hydrateMap(this.chunks, restored.chunks);
  }

  findAll(projectId: string): DocumentRecord[] {
    this.projectsService.findOne(projectId);
    return this.documents.filter((doc) => doc.projectId === projectId);
  }

  findByProject(projectId: string, documentId: string): DocumentRecord {
    this.projectsService.findOne(projectId);
    const doc = this.documents.find((d) => d.id === documentId && d.projectId === projectId);
    if (!doc) {
      throw new NotFoundException(`未找到文档: ${documentId}`);
    }
    return doc;
  }

  findById(documentId: string): DocumentRecord {
    const doc = this.documents.find((d) => d.id === documentId);
    if (!doc) {
      throw new NotFoundException(`未找到文档: ${documentId}`);
    }
    this.projectsService.findOne(doc.projectId);
    return doc;
  }

  create(projectId: string, payload: { title: string; content: string }): DocumentRecord {
    this.projectsService.findOne(projectId);

    const title = payload.title?.trim();
    const content = payload.content?.trim();
    if (!title) {
      throw new BadRequestException('title 不能为空');
    }
    if (!content) {
      throw new BadRequestException('content 不能为空');
    }

    const now = new Date();
    const doc: DocumentRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      title,
      content,
      indexStatus: 'pending',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.documents.push(doc);
    this.versions.set(doc.id, [
      {
        version: 1,
        title,
        content,
        createdAt: now,
      },
    ]);
    this.persistState();
    return doc;
  }

  update(documentId: string, payload: { title?: string; content?: string }): DocumentRecord {
    const doc = this.findById(documentId);

    const now = new Date();
    if (payload.title !== undefined) {
      doc.title = payload.title.trim() || doc.title;
    }
    if (payload.content !== undefined) {
      doc.content = payload.content;
    }

    doc.version += 1;
    doc.updatedAt = now;

    const docVersions = this.versions.get(documentId) || [];
    docVersions.push({
      version: doc.version,
      title: doc.title,
      content: doc.content,
      createdAt: now,
    });
    this.versions.set(documentId, docVersions);

    this.persistState();
    return doc;
  }

  removeByProjectId(projectId: string): number {
    const documentIds = listDocumentIdsForProject(this.documents, projectId);
    for (const documentId of documentIds) {
      this.remove(documentId);
    }
    return documentIds.length;
  }

  remove(documentId: string): void {
    this.findById(documentId);
    const index = this.documents.findIndex((d) => d.id === documentId);
    if (index === -1) {
      throw new NotFoundException(`未找到文档: ${documentId}`);
    }

    this.documents.splice(index, 1);
    this.versions.delete(documentId);
    this.chunks.delete(documentId);
    this.persistState();
  }

  reindex(documentId: string): ReindexResult {
    const doc = this.findById(documentId);

    doc.indexStatus = 'indexing';
    doc.updatedAt = new Date();
    this.persistState();

    const workerUrl = process.env.WORKER_URL || 'http://localhost:3002';

    axios
      .post(`${workerUrl}/api/jobs`, {
        type: 'ingestion',
        targetType: 'document',
        targetId: documentId,
        projectId: doc.projectId,
        mode: 'full',
      })
      .catch((error) => {
        console.error(
          `Failed to dispatch ingestion job for document ${documentId}:`,
          error.message
        );
        doc.indexStatus = 'failed';
        this.persistState();
      });

    return { documentId, indexStatus: 'indexing' };
  }

  getChunks(documentId: string): ChunkRecord[] {
    this.findById(documentId);
    return this.chunks.get(documentId) || [];
  }

  getVersions(documentId: string): DocumentVersion[] {
    this.findById(documentId);
    return this.versions.get(documentId) || [];
  }

  commitIndexResult(documentId: string, payload: CommitIndexResultInput): DocumentRecord {
    const doc = this.findById(documentId);
    const now = new Date();

    if (payload.status === 'failed') {
      doc.indexStatus = 'failed';
      doc.updatedAt = now;
      this.persistState();
      return doc;
    }

    const chunks = (payload.chunks || []).map((chunk) => ({
      id: chunk.id,
      documentId,
      content: chunk.content,
      metadata: {
        ...(chunk.metadata || {}),
        ...(chunk.embedding ? { embedding: chunk.embedding } : {}),
      },
      createdAt: now,
    }));

    this.chunks.set(documentId, chunks);
    doc.indexStatus = 'completed';
    doc.updatedAt = now;
    this.persistState();
    return doc;
  }

  private generateChunks(doc: DocumentRecord): ChunkRecord[] {
    const content = doc.content;
    const chunkSize = 500;
    const chunks: ChunkRecord[] = [];
    const now = new Date();

    for (let i = 0; i < content.length; i += chunkSize) {
      const chunkContent = content.slice(i, i + chunkSize);
      if (chunkContent.trim().length === 0) continue;

      chunks.push({
        id: `${doc.id}-chunk-${i / chunkSize}`,
        documentId: doc.id,
        content: chunkContent,
        metadata: {
          index: i / chunkSize,
          total: Math.ceil(content.length / chunkSize),
          docTitle: doc.title,
        },
        createdAt: now,
      });
    }

    if (chunks.length === 0) {
      chunks.push({
        id: `${doc.id}-chunk-0`,
        documentId: doc.id,
        content: doc.content,
        metadata: { index: 0, total: 1, docTitle: doc.title },
        createdAt: now,
      });
    }

    return chunks;
  }

  private persistState() {
    const payload = this.buildPersistedPayload();
    const targetDir = dirname(this.storagePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
    if (usePostgresPersistence()) {
      void syncDocumentsToPostgres(this.prisma, payload).catch((err) =>
        console.error('[persistence] documents PG 同步失败', err)
      );
    }
  }

  private buildPersistedPayload(): PersistedDocumentsPayload {
    const payload: PersistedDocumentsPayload = {
      documents: this.documents.map((doc) => ({
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      })),
      versions: {},
      chunks: {},
    };

    for (const [docId, docVersions] of this.versions.entries()) {
      payload.versions[docId] = docVersions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      }));
    }

    for (const [docId, docChunks] of this.chunks.entries()) {
      payload.chunks[docId] = docChunks.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      }));
    }

    return payload;
  }

  private restoreStateFromDisk(): RestoredDocumentsState | null {
    if (!existsSync(this.storagePath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedDocumentState;
      return {
        documents: (parsed.documents || []).map((doc) => ({
          ...doc,
          createdAt: new Date(doc.createdAt),
          updatedAt: new Date(doc.updatedAt),
        })),
        versions: Object.fromEntries(
          Object.entries(parsed.versions || {}).map(([docId, versions]) => [
            docId,
            (versions || []).map((v) => ({
              ...v,
              createdAt: new Date(v.createdAt),
            })),
          ])
        ),
        chunks: Object.fromEntries(
          Object.entries(parsed.chunks || {}).map(([docId, chunks]) => [
            docId,
            (chunks || []).map((c) => ({
              ...c,
              createdAt: new Date(c.createdAt),
            })),
          ])
        ),
      };
    } catch {
      return null;
    }
  }

  private hydrateMap<T>(target: Map<string, T>, source: Record<string, T>) {
    for (const [key, value] of Object.entries(source)) {
      target.set(key, value);
    }
  }
}
