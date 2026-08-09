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
  deleteDocumentFromPostgres,
  loadDocumentsFromPostgres,
  syncDocumentsToPostgres,
  syncSingleDocumentToPostgres,
  type PersistedDocumentsPayload,
  type RestoredDocumentsState,
} from '../../persistence/documents-pg-sync';
import { createAsyncSerialQueue } from '../../persistence/async-serial-queue';
import {
  DEFAULT_USER_DOC_TYPE,
  docTypeForIngestion,
  normalizeDocType,
} from './documents-type.util';
import { nextIndexStatusAfterContentChange } from './documents-index-status.util';

interface PersistedDocumentState {
  documents: Array<{
    id: string;
    projectId: string;
    title: string;
    content: string;
    docType?: string;
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
  /** PG 全量同步串行队列：避免并发 fire-and-forget 旧快照覆盖新快照 */
  private readonly pgSyncQueue = createAsyncSerialQueue();
  /** 同文档保存后自动索引防抖 */
  private readonly reindexTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly REINDEX_DEBOUNCE_MS = 800;

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
      }
    } catch (err) {
      console.error('[persistence] documents PG 初始化失败', err);
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

  async create(
    projectId: string,
    payload: { title: string; content: string; docType?: string; personaId?: string | null }
  ): Promise<DocumentRecord> {
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
    const docType = normalizeDocType(payload.docType);
    const personaId = this.resolvePersonaIdForDocument(projectId, docType, payload.personaId);

    const doc: DocumentRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      title,
      content,
      docType,
      personaId,
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
    await this.persistStateAndAwaitPgSync({ documentIds: [doc.id] });
    this.scheduleAutoReindex(doc.id);
    return doc;
  }

  async update(
    documentId: string,
    payload: { title?: string; content?: string; docType?: string; personaId?: string | null }
  ): Promise<DocumentRecord> {
    const doc = this.findById(documentId);

    const now = new Date();
    let contentChanged = false;
    if (payload.title !== undefined) {
      const nextTitle = payload.title.trim() || doc.title;
      if (nextTitle !== doc.title) {
        contentChanged = true;
      }
      doc.title = nextTitle;
    }
    if (payload.content !== undefined) {
      if (payload.content !== doc.content) {
        contentChanged = true;
      }
      doc.content = payload.content;
    }
    if (payload.docType !== undefined) {
      const nextType = normalizeDocType(payload.docType);
      if (nextType !== doc.docType) {
        contentChanged = true;
      }
      doc.docType = nextType;
    }
    if (payload.personaId !== undefined) {
      doc.personaId = this.resolvePersonaIdForDocument(doc.projectId, doc.docType, payload.personaId);
    }

    doc.version += 1;
    doc.updatedAt = now;

    if (contentChanged) {
      doc.indexStatus = nextIndexStatusAfterContentChange(doc.indexStatus);
    }

    const docVersions = this.versions.get(documentId) || [];
    docVersions.push({
      version: doc.version,
      title: doc.title,
      content: doc.content,
      createdAt: now,
    });
    this.versions.set(documentId, docVersions);

    await this.persistStateAndAwaitPgSync({ documentIds: [documentId] });
    if (contentChanged) {
      this.scheduleAutoReindex(documentId);
    }
    return doc;
  }

  async removeByProjectId(projectId: string): Promise<number> {
    const documentIds = listDocumentIdsForProject(this.documents, projectId);
    for (const documentId of documentIds) {
      // 内存侧先删干净，最后一次落库，避免 N 次全量同步
      this.findById(documentId);
      const index = this.documents.findIndex((d) => d.id === documentId);
      if (index !== -1) {
        this.documents.splice(index, 1);
      }
      this.versions.delete(documentId);
      this.chunks.delete(documentId);
    }
    if (documentIds.length > 0) {
      await this.persistStateAndAwaitPgSync({ deletedDocumentIds: documentIds });
    }
    return documentIds.length;
  }

  async remove(documentId: string): Promise<void> {
    this.clearAutoReindex(documentId);
    this.findById(documentId);
    const index = this.documents.findIndex((d) => d.id === documentId);
    if (index === -1) {
      throw new NotFoundException(`未找到文档: ${documentId}`);
    }

    this.documents.splice(index, 1);
    this.versions.delete(documentId);
    this.chunks.delete(documentId);
    await this.persistStateAndAwaitPgSync({ deletedDocumentIds: [documentId] });
  }

  /** 保存后排队自动索引；同文档短时间多次保存合并为一次 */
  private scheduleAutoReindex(documentId: string): void {
    this.clearAutoReindex(documentId);
    const timer = setTimeout(() => {
      this.reindexTimers.delete(documentId);
      void this.reindex(documentId).catch((err) => {
        console.error(`[documents] 自动索引失败 document=${documentId}`, err);
      });
    }, DocumentsService.REINDEX_DEBOUNCE_MS);
    this.reindexTimers.set(documentId, timer);
  }

  private clearAutoReindex(documentId: string): void {
    const prev = this.reindexTimers.get(documentId);
    if (prev) {
      clearTimeout(prev);
      this.reindexTimers.delete(documentId);
    }
  }

  async reindex(documentId: string): Promise<ReindexResult> {
    const doc = this.findById(documentId);

    doc.indexStatus = 'indexing';
    doc.updatedAt = new Date();
    await this.persistStateAndAwaitPgSync({ documentIds: [documentId] });

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
        void this.persistStateAndAwaitPgSync({ documentIds: [documentId] }).catch((err) =>
          console.error('[persistence] documents PG 同步失败', err)
        );
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

  batchGet(
    projectId: string,
    documentIds: string[]
  ): Array<{ id: string; title: string; content: string; type: string; docType: string }> {
    this.projectsService.findOne(projectId);
    const uniqueIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
    if (uniqueIds.length === 0) {
      throw new BadRequestException('documentIds 不能为空');
    }

    const out: Array<{ id: string; title: string; content: string; type: string; docType: string }> =
      [];
    for (const id of uniqueIds) {
      const doc = this.documents.find((d) => d.id === id && d.projectId === projectId);
      if (!doc) {
        continue;
      }
      const docType = doc.docType ?? DEFAULT_USER_DOC_TYPE;
      out.push({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        type: docTypeForIngestion(docType, doc.title, doc.content),
        docType,
      });
    }
    return out;
  }

  async commitIndexResult(
    documentId: string,
    payload: CommitIndexResultInput
  ): Promise<DocumentRecord> {
    const doc = this.findById(documentId);
    const now = new Date();

    if (payload.status === 'failed') {
      doc.indexStatus = 'failed';
      doc.updatedAt = now;
      await this.persistStateAndAwaitPgSync({ documentIds: [documentId] });
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
    await this.persistStateAndAwaitPgSync({ documentIds: [documentId] });
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

  /** 关键写：落库完成后再返回；PG 模式下经串行队列，防止旧快照覆盖 */
  private resolvePersonaIdForDocument(
    projectId: string,
    docType: string,
    personaId: string | null | undefined
  ): string | null {
    if (personaId === undefined) {
      return null;
    }
    const normalized = personaId?.trim() || null;
    if (!normalized) {
      return null;
    }
    if (docType !== 'persona_card') {
      throw new BadRequestException('仅 persona_card 文档可设置 personaId');
    }
    const personas = this.projectsService.getPersonas(projectId);
    if (!personas.some((p) => p.id === normalized)) {
      throw new BadRequestException(`personaId 不属于本项目: ${normalized}`);
    }
    return normalized;
  }

  /** 写路径默认增量同步；未指定 documentIds/deletedDocumentIds 时走全量（兼容启动对账） */
  private async persistStateAndAwaitPgSync(options?: {
    documentIds?: string[];
    deletedDocumentIds?: string[];
  }): Promise<void> {
    const payload = this.buildPersistedPayload();
    if (!usePostgresPersistence()) {
      const targetDir = dirname(this.storagePath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
      return;
    }

    try {
      await this.pgSyncQueue.enqueue(async () => {
        const deletedIds = options?.deletedDocumentIds ?? [];
        for (const documentId of deletedIds) {
          await deleteDocumentFromPostgres(this.prisma, documentId);
        }
        const documentIds = options?.documentIds;
        if (documentIds && documentIds.length > 0) {
          for (const documentId of documentIds) {
            await syncSingleDocumentToPostgres(this.prisma, payload, documentId);
          }
          return;
        }
        if (deletedIds.length > 0 && (!documentIds || documentIds.length === 0)) {
          return;
        }
        await syncDocumentsToPostgres(this.prisma, payload);
      });
    } catch (err) {
      console.error('[persistence] documents PG 同步失败', err);
      throw err;
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
          docType: normalizeDocType((doc as { docType?: string }).docType),
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
