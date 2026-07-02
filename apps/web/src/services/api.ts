/**
 * Aether Quill API Client
 * Auto-generated from OpenAPI specification
 *
 * This client provides type-safe access to all API endpoints
 * using types generated from the OpenAPI specification.
 */

import axios, { AxiosInstance } from 'axios';
import type { paths, components } from '@aether-quill/shared-types';
import {
  resolveEffectiveStructuredMatchingText,
  resolveWorkbenchStructuredInfo,
} from '../utils/structured-matching';
import { readSseLines, readSseSegments } from '../utils/sseStream';

// Type helpers
type PathMethod<T extends keyof paths> = {
  [K in keyof paths[T]]: K extends 'parameters' ? never : K;
}[keyof paths[T]];

type RequestBody<T extends keyof paths, M extends PathMethod<T>> = paths[T][M] extends {
  requestBody?: { content: { 'application/json': infer R } };
}
  ? R
  : undefined;

type ResponseData<T extends keyof paths, M extends PathMethod<T>> = paths[T][M] extends {
  responses: { 200: { content: { 'application/json': infer R } } };
}
  ? R
  : paths[T][M] extends {
        responses: { 201: { content: { 'application/json': infer R } } };
      }
    ? R
    : unknown;

// SSE event types for generation streaming
export interface SseStartEvent {
  event: 'start';
  traceId: string;
  chapterNo: number;
}

export interface SseContentEvent {
  event: 'content';
  data: string;
  traceId: string;
}

export interface CitationItem {
  sourceType: string;
  sourceId: string;
  snippet: string;
}

/** 检索命中的完整文档（角色卡回表等），与 orchestrator trace `full_documents` 对齐 */
export type RetrievalFullDocument = components['schemas']['RetrievalFullDocument'];

export interface ConsistencyNote {
  level: 'info' | 'warning' | 'block';
  message: string;
}

export interface SseEndEvent {
  event: 'end';
  traceId: string;
  citations: CitationItem[];
  consistencyNotes: ConsistencyNote[];
  usedRelationEvents?: UsedRelationEventItem[];
  finalText?: string;
  finalDraftText?: string;
  contentSafety?: ContentSafetyScanResult;
}

export interface SseErrorEvent {
  event: 'error';
  data: string;
  traceId: string;
}

export type GenerationPhase =
  | 'retrieving'
  | 'building_prompt'
  | 'waiting_llm'
  | 'generating'
  | 'checking'
  | 'content_safety_scan'
  | 'content_safety_rewrite';

export type AiTaskProgressEvent = components['schemas']['AiTaskProgressEvent'];
export type ContentSafetyScanResult = components['schemas']['ContentSafetyScanResult'];

export interface SsePhaseEvent {
  event: GenerationPhase | 'progress' | 'content_replace';
  traceId?: string;
  taskKey?: string;
  stage?: string;
  message?: string;
  currentStep?: number;
  totalSteps?: number;
  data?: string;
}

export type SseEvent =
  | SseStartEvent
  | SseContentEvent
  | SseEndEvent
  | SseErrorEvent
  | SsePhaseEvent;

export interface SseCallbacks {
  onStart?: (traceId: string, chapterNo: number) => void;
  onPhase?: (phase: GenerationPhase) => void;
  onProgress?: (event: AiTaskProgressEvent) => void;
  onContent?: (text: string) => void;
  onContentReplace?: (text: string) => void;
  onEnd?: (
    traceId: string,
    citations: CitationItem[],
    consistencyNotes: ConsistencyNote[],
    usedRelationEvents: UsedRelationEventItem[],
    meta?: { finalText?: string; contentSafety?: ContentSafetyScanResult }
  ) => void;
  onError?: (error: string) => void;
}

export type SseStreamOptions = { signal?: AbortSignal };

async function ensureAuthToken(): Promise<string> {
  const { useAuthStore } = await import('../stores/auth');
  await useAuthStore().ensureFreshSession();
  return localStorage.getItem('token') || '';
}

async function requestAuthorizedSse(
  url: string,
  init: { method: string; body?: string; signal?: AbortSignal },
  parseMode: 'segments' | 'lines',
  onDataLine: (dataLine: string) => void
): Promise<void> {
  const token = await ensureAuthToken();
  const response = await fetch(url, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init.body,
    signal: init.signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      redirectToLogin();
    }
    const errorBody = await response.text().catch(() => '');
    throw new Error(errorBody || `SSE request failed: ${response.statusText}`);
  }

  if (parseMode === 'lines') {
    await readSseLines(response, onDataLine, init.signal);
    return;
  }

  await readSseSegments(response, onDataLine, init.signal);
}

export interface ProjectWritingStats {
  totalCharCount: number;
  chapterCharCounts: Array<{ chapterNo: number; charCount: number }>;
  totalTokens: number;
  generationTotal: number;
  generationCompleted: number;
  generationFailed: number;
}

/** 开发默认相对路径，走 Vite proxy，支持 localhost / 局域网 IP 访问 */
function getApiBaseURL(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  if (import.meta.env.DEV) {
    return '';
  }
  return 'http://localhost:3000';
}

// Create axios instance
const http: AxiosInstance = axios.create({
  baseURL: getApiBaseURL(),
  headers: {
    'Content-Type': 'application/json',
  },
});

function getRagOrchestratorBaseURL() {
  const configured = import.meta.env.VITE_RAG_ORCHESTRATOR_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (import.meta.env.DEV) {
    return '';
  }

  return 'http://localhost:3001';
}

function shouldSkipSessionRefresh(url: string): boolean {
  return url.includes('/api/auth/login') || url.includes('/api/auth/refresh');
}

function redirectToLogin() {
  // localStorage.removeItem('token');
  // localStorage.removeItem('refreshToken');
  // if (window.location.pathname !== '/login') {
  //   window.location.href = '/login';
  // }
}

// Request interceptor for auth
http.interceptors.request.use(async (config) => {
  const requestUrl = config.url || '';
  if (!shouldSkipSessionRefresh(requestUrl)) {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();
  }

  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for unified response format
http.interceptors.response.use(
  (response) => {
    // 统一响应格式：{ code, msg, data }
    const data = response.data;
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 0) {
        // 成功响应，直接返回 data 字段
        response.data = data.data;
      } else {
        // 错误响应，抛出错误
        throw new Error(data.msg || 'Request failed');
      }
    }
    return response;
  },
  (error) => {
    // 处理错误响应
    if (error.response?.data) {
      const data = error.response.data;
      if (data && typeof data === 'object' && 'msg' in data) {
        error.message = data.msg;
      }
    }
    if (error.response?.status === 401) {
      void import('../utils/pageFeedback').then(({ presentError }) => {
        presentError('登录已过期，请重新登录');
      });
      redirectToLogin();
    }
    throw error;
  }
);

// Legacy API methods for backward compatibility
export const apiClient = {
  unwrapPayload<T>(result: unknown): T {
    if (
      result &&
      typeof result === 'object' &&
      'data' in result &&
      (result as { data?: unknown }).data !== undefined
    ) {
      return (result as { data: T }).data;
    }
    return result as T;
  },

  // Compatibility methods
  async getProjects() {
    const result = await this.projects.list();
    return this.unwrapPayload<ProjectItem[]>(result);
  },

  async createProject(payload: { name: string; description: string }) {
    const result = await this.projects.create(payload);
    return this.unwrapPayload<ProjectItem>(result);
  },

  async deleteProject(projectId: string) {
    const result = await this.projects.delete(projectId);
    return this.unwrapPayload<{ id: string }>(result);
  },

  async getWorkspace(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/workspace`);
    return this.unwrapPayload<{
      project: ProjectItem;
      settings: ProjectSettings;
      personas: PersonaItem[];
      knowledge: KnowledgeItem;
      identityRelations: components['schemas']['PersonaIdentityRelation'][];
      latestIndexJob: IndexJob | null;
      latestSummaryJob: SummaryJob | null;
    }>(response.data);
  },

  async getProjectExport(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/export`);
    return this.unwrapPayload<ProjectExportBundle>(response.data);
  },

  async getWriteContextReadiness(projectId: string, chapterNo: number) {
    const response = await http.get(`/api/projects/${projectId}/write-context-readiness`, {
      params: { chapterNo },
    });
    return this.unwrapPayload<WriteContextReadiness>(response.data);
  },

  async getSettings(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/settings`);
    const payload = this.unwrapPayload<ProjectSettings>(response.data);
    if (!Array.isArray(payload.contentSafetyCustomRules)) {
      payload.contentSafetyCustomRules = [];
    }
    return payload;
  },

  async getProjectStats(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/stats`);
    return this.unwrapPayload<ProjectWritingStats>(response.data);
  },

  async updateSettings(projectId: string, payload: components['schemas']['ProjectSettingsUpdate']) {
    const response = await http.put(`/api/projects/${projectId}/settings`, payload);
    const data = this.unwrapPayload<ProjectSettings>(response.data);
    if (!Array.isArray(data.contentSafetyCustomRules)) {
      data.contentSafetyCustomRules = [];
    }
    return data;
  },

  async getPersonas(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/personas`);
    return this.unwrapPayload<PersonaItem[]>(response.data);
  },

  async createPersona(
    projectId: string,
    payload: { name: string; profile: string; state?: string }
  ) {
    const response = await http.post(`/api/projects/${projectId}/personas`, payload);
    return this.unwrapPayload<PersonaItem>(response.data);
  },

  async publishPersona(projectId: string, personaId: string) {
    const response = await http.post(`/api/projects/${projectId}/personas/${personaId}/publish`);
    return this.unwrapPayload<PersonaItem>(response.data);
  },

  async updatePersona(
    projectId: string,
    personaId: string,
    payload: { name?: string; profile?: string; state?: string }
  ) {
    const response = await http.put(`/api/projects/${projectId}/personas/${personaId}`, payload);
    return this.unwrapPayload<PersonaItem>(response.data);
  },

  async deletePersona(projectId: string, personaId: string) {
    const response = await http.delete(`/api/projects/${projectId}/personas/${personaId}`);
    return this.unwrapPayload<{ id: string }>(response.data);
  },

  async getKnowledge(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/knowledge`);
    return this.unwrapPayload<KnowledgeItem>(response.data);
  },

  async updateOutline(projectId: string, payload: { outlineSummary: string }) {
    const response = await http.put(`/api/projects/${projectId}/knowledge/outline`, payload);
    return this.unwrapPayload<KnowledgeItem>(response.data);
  },

  async upsertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string }
  ) {
    const response = await http.post(`/api/projects/${projectId}/knowledge/chapters`, payload);
    return this.unwrapPayload<ChapterUpsertResult>(response.data);
  },

  async chapterAfterSaveSSE(
    projectId: string,
    chapterNo: number,
    actions: Array<'persona' | 'relationEvents'>,
    callbacks: {
      onProgress?: (event: { event: string; action: string; status: string }) => void;
      onDone?: () => void;
      onError?: (message: string) => void;
    },
    options?: SseStreamOptions
  ): Promise<void> {
    await requestAuthorizedSse(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/after-save`,
      {
        method: 'PUT',
        body: JSON.stringify({ actions }),
        signal: options?.signal,
      },
      'lines',
      (dataLine) => {
        try {
          const data = JSON.parse(dataLine) as {
            event: string;
            action?: string;
            status?: string;
            message?: string;
          };
          if (data.event === 'progress' && data.action && data.status) {
            callbacks.onProgress?.({
              event: data.event,
              action: data.action,
              status: data.status,
            });
          } else if (data.event === 'done') {
            callbacks.onDone?.();
          } else if (data.event === 'error') {
            callbacks.onError?.(data.message || 'after-save failed');
          }
        } catch {
          // ignore malformed SSE
        }
      }
    );
  },

  async previewRetrieval(
    projectId: string,
    body: {
      prompt?: string;
      chapterNo?: number;
      useStructuredKb?: boolean;
      projectCtx: {
        outlineSummary: string;
        personaProfile: string;
        chapters: Array<{
          chapterNo: number;
          title: string;
          summary: string;
          content?: string;
          contentTail?: string;
          structuredMatchingText?: string;
        }>;
        knowledgeDocuments?: Array<{
          id: string;
          title: string;
          content: string;
          docType?: string;
        }>;
        chapterSummaryPromptCount?: number;
        chapterSummaryMemoryCount?: number;
        priorChapterTailChars?: number;
        contextExcerptMaxChars?: number;
        personas?: ReturnType<typeof buildPersonasContextPayload>;
      };
      extraContext?: Record<string, unknown>;
    }
  ): Promise<PreviewRetrievalResult> {
    const response = await http.post('/api/preview-retrieval', { projectId, ...body });
    return this.unwrapPayload<PreviewRetrievalResult>(response.data);
  },

  async insertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/insert`,
      payload
    );
    return this.unwrapPayload<ChapterItem>(response.data);
  },

  async deleteChapter(projectId: string, chapterNo: number) {
    const response = await http.delete(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}`
    );
    return this.unwrapPayload<{ id: number }>(response.data);
  },

  async renumberChapters(projectId: string) {
    const response = await http.post(`/api/projects/${projectId}/knowledge/chapters/renumber`);
    return this.unwrapPayload<{ renumberedCount: number }>(response.data);
  },

  async parseChapterStructuredInfo(
    projectId: string,
    chapterNo: number,
    payload: {
      mode: 'workbench' | 'chapter';
      goal?: string;
      pov?: string;
      mustInclude?: string[];
      avoid?: string[];
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/structured-info/parse`,
      payload
    );
    return this.unwrapPayload<StructuredInfoParseResult>(response.data);
  },

  async createReindexJob(projectId: string, payload: { mode?: 'full' | 'incremental' } = {}) {
    const response = await http.post(`/api/projects/${projectId}/knowledge/reindex`, payload);
    return this.unwrapPayload<IndexJob>(response.data);
  },

  async getReindexJob(projectId: string, jobId: string) {
    const response = await http.get(`/api/projects/${projectId}/knowledge/reindex/${jobId}`);
    return this.unwrapPayload<IndexJob>(response.data);
  },

  async createChapterSummaryJob(projectId: string, chapterNo: number) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/summarize`
    );
    return this.unwrapPayload<SummaryJob>(response.data);
  },

  async createBatchSummaryJob(projectId: string, payload: { chapterNos?: number[] } = {}) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/summarize`,
      payload
    );
    return this.unwrapPayload<SummaryJob>(response.data);
  },

  async rebuildChapterSummaryMemory(
    projectId: string,
    payload: { chapterNos?: number[]; source?: 'existing' | 'content_fallback' } = {}
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/rebuild-summary-memory`,
      payload
    );
    return this.unwrapPayload<ChapterSummaryMemoryRebuildResult>(response.data);
  },

  async getSummaryJob(projectId: string, jobId: string) {
    const response = await http.get(`/api/projects/${projectId}/knowledge/summarize/${jobId}`);
    return this.unwrapPayload<SummaryJob>(response.data);
  },

  async generateChapterRelationEvents(projectId: string, chapterNo: number) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/relation-events/generate`
    );
    return this.unwrapPayload<ChapterRelationEventGenerateResult>(response.data);
  },

  async writeChapter(
    projectId: string,
    payload: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords?: number;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    }
  ) {
    const response = await http.post(`/api/projects/${projectId}/write`, payload);
    return this.unwrapPayload<WriteResult>(response.data);
  },

  async getRelationEvents(
    projectId: string,
    params: {
      counterparty?: string;
      chapterNo?: number;
      keyword?: string;
      appearingCharacters?: string[];
    } = {}
  ) {
    const response = await http.get(`/api/projects/${projectId}/relation-events`, {
      params: {
        ...params,
        appearingCharacters: params.appearingCharacters?.join(','),
      },
    });
    return this.unwrapPayload<RelationEventItem[]>(response.data);
  },

  async createRelationEvent(projectId: string, payload: RelationEventInput) {
    const response = await http.post(`/api/projects/${projectId}/relation-events`, payload);
    return this.unwrapPayload<RelationEventItem>(response.data);
  },

  async updateRelationEvent(projectId: string, eventId: string, payload: RelationEventInput) {
    const response = await http.put(
      `/api/projects/${projectId}/relation-events/${eventId}`,
      payload
    );
    return this.unwrapPayload<RelationEventItem>(response.data);
  },

  async deleteRelationEvent(projectId: string, eventId: string) {
    const response = await http.delete(`/api/projects/${projectId}/relation-events/${eventId}`);
    return this.unwrapPayload<{ id: string }>(response.data);
  },

  // Auth API
  auth: {
    async login(
      payload: RequestBody<'/api/auth/login', 'post'>
    ): Promise<ResponseData<'/api/auth/login', 'post'>> {
      const response = await http.post('/api/auth/login', payload);
      return response.data;
    },

    async me(): Promise<ResponseData<'/api/auth/me', 'get'>> {
      const response = await http.get('/api/auth/me');
      return response.data;
    },

    async refresh(payload: { refreshToken: string }): Promise<{
      accessToken: string;
      refreshToken: string;
    }> {
      const response = await http.post('/api/auth/refresh', payload);
      return response.data;
    },
  },

  // Projects API
  projects: {
    async list(): Promise<ResponseData<'/api/projects', 'get'>> {
      const response = await http.get('/api/projects');
      return response.data;
    },

    async create(
      payload: RequestBody<'/api/projects', 'post'>
    ): Promise<ResponseData<'/api/projects', 'post'>> {
      const response = await http.post('/api/projects', payload);
      return response.data;
    },

    async get(id: string): Promise<ResponseData<'/api/projects/{id}', 'get'>> {
      const response = await http.get(`/api/projects/${id}`);
      return response.data;
    },

    async update(
      id: string,
      payload: RequestBody<'/api/projects/{id}', 'patch'>
    ): Promise<ResponseData<'/api/projects/{id}', 'patch'>> {
      const response = await http.patch(`/api/projects/${id}`, payload);
      return response.data;
    },

    async delete(id: string): Promise<ResponseData<'/api/projects/{id}', 'delete'>> {
      const response = await http.delete(`/api/projects/${id}`);
      return response.data;
    },
  },

  // Documents API
  documents: {
    async list(projectId: string): Promise<ResponseData<'/api/projects/{id}/documents', 'get'>> {
      const response = await http.get(`/api/projects/${projectId}/documents`);
      return response.data;
    },

    async create(
      projectId: string,
      payload: RequestBody<'/api/projects/{id}/documents', 'post'>
    ): Promise<ResponseData<'/api/projects/{id}/documents', 'post'>> {
      const response = await http.post(`/api/projects/${projectId}/documents`, payload);
      return response.data;
    },

    async reindex(id: string): Promise<ResponseData<'/api/documents/{id}/reindex', 'post'>> {
      const response = await http.post(`/api/documents/${id}/reindex`);
      return response.data;
    },

    async getChunks(id: string): Promise<ResponseData<'/api/documents/{id}/chunks', 'get'>> {
      const response = await http.get(`/api/documents/${id}/chunks`);
      return response.data;
    },

    async batchGet(
      projectId: string,
      documentIds: string[]
    ): Promise<ResponseData<'/api/documents/batch-get', 'post'>> {
      const response = await http.post('/api/documents/batch-get', { projectId, documentIds });
      return response.data;
    },
  },

  // Generation API
  generation: {
    async generate(
      projectId: string,
      payload: RequestBody<'/api/projects/{id}/generate', 'post'>
    ): Promise<ResponseData<'/api/projects/{id}/generate', 'post'>> {
      const response = await http.post(`/api/projects/${projectId}/generate`, payload);
      return response.data;
    },

    async listTraces(
      projectId: string,
      params?: { limit?: number; offset?: number }
    ): Promise<ResponseData<'/api/projects/{id}/generation-traces', 'get'>> {
      const response = await http.get(`/api/projects/${projectId}/generation-traces`, { params });
      return response.data;
    },
  },

  // Drafts API
  drafts: {
    async accept(
      id: string,
      payload?: RequestBody<'/api/drafts/{id}/accept', 'post'>
    ): Promise<ResponseData<'/api/drafts/{id}/accept', 'post'>> {
      const response = await http.post(`/api/drafts/${id}/accept`, payload);
      return response.data;
    },

    async rewrite(
      id: string,
      payload: RequestBody<'/api/drafts/{id}/rewrite', 'post'>
    ): Promise<ResponseData<'/api/drafts/{id}/rewrite', 'post'>> {
      const response = await http.post(`/api/drafts/${id}/rewrite`, payload);
      return response.data;
    },
  },

  // Prompt Config API
  promptConfig: {
    async get(projectId: string): Promise<ResponseData<'/api/projects/{id}/prompt-config', 'get'>> {
      const response = await http.get(`/api/projects/${projectId}/prompt-config`);
      return response.data;
    },

    async update(
      projectId: string,
      payload: RequestBody<'/api/projects/{id}/prompt-config', 'put'>
    ): Promise<ResponseData<'/api/projects/{id}/prompt-config', 'put'>> {
      const response = await http.put(`/api/projects/${projectId}/prompt-config`, payload);
      return response.data;
    },

    async publish(
      projectId: string,
      payload?: { systemPromptText?: string }
    ): Promise<ResponseData<'/api/projects/{id}/prompt-config/publish', 'post'>> {
      const response = await http.post(
        `/api/projects/${projectId}/prompt-config/publish`,
        payload ?? {}
      );
      return response.data;
    },

    async rollback(
      projectId: string,
      payload: RequestBody<'/api/projects/{id}/prompt-config/rollback', 'post'>
    ): Promise<ResponseData<'/api/projects/{id}/prompt-config/rollback', 'post'>> {
      const response = await http.post(
        `/api/projects/${projectId}/prompt-config/rollback`,
        payload
      );
      return response.data;
    },
  },

  taskPrompts: {
    async list(projectId: string): Promise<TaskPromptListItem[]> {
      const response = await http.get(`/api/projects/${projectId}/task-prompts`);
      return apiClient.unwrapPayload<TaskPromptListItem[]>(response.data);
    },

    async get(projectId: string, templateKey: string): Promise<TaskPromptListItem> {
      const encodedKey = encodeURIComponent(templateKey);
      const response = await http.get(
        `/api/projects/${projectId}/task-prompts/${encodedKey}`
      );
      return apiClient.unwrapPayload<TaskPromptListItem>(response.data);
    },

    async saveDraft(
      projectId: string,
      templateKey: string,
      draftText: string
    ): Promise<TaskPromptListItem> {
      const encodedKey = encodeURIComponent(templateKey);
      const response = await http.put(`/api/projects/${projectId}/task-prompts/${encodedKey}`, {
        draftText,
      });
      return apiClient.unwrapPayload<TaskPromptListItem>(response.data);
    },

    async publish(projectId: string, templateKey: string): Promise<TaskPromptPublishResult> {
      const encodedKey = encodeURIComponent(templateKey);
      const response = await http.post(
        `/api/projects/${projectId}/task-prompts/${encodedKey}/publish`
      );
      return apiClient.unwrapPayload<TaskPromptPublishResult>(response.data);
    },

    async rollback(
      projectId: string,
      templateKey: string,
      payload?: { targetVersion?: number }
    ): Promise<TaskPromptRollbackResult> {
      const encodedKey = encodeURIComponent(templateKey);
      const response = await http.post(
        `/api/projects/${projectId}/task-prompts/${encodedKey}/rollback`,
        payload ?? {}
      );
      return apiClient.unwrapPayload<TaskPromptRollbackResult>(response.data);
    },
  },

  // Prompt Templates API (for version history)
  async listPromptTemplates(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/prompt-templates`);
    return response.data;
  },

  async getTemplateVersions(projectId: string, templateId: string) {
    const response = await http.get(
      `/api/projects/${projectId}/prompt-templates/${templateId}/versions`
    );
    return response.data;
  },

  async syncProjectContext(
    projectId: string,
    options: {
      selectedEventIds?: string[];
    } = {}
  ) {
    const workspace = await this.getWorkspace(projectId);
    const promptConfigRes = await http.get(`/api/projects/${projectId}/prompt-config`);
    const promptConfig = this.unwrapPayload<{ systemPromptText?: string }>(promptConfigRes.data);
    const resolvedSystemPromptText =
      (typeof promptConfig?.systemPromptText === 'string' &&
        promptConfig.systemPromptText.trim()) ||
      workspace.settings.systemPromptText;
    const activePersona =
      workspace.personas.find((persona) => persona.id === workspace.settings.activePersonaId) ||
      workspace.personas.find((persona) => persona.status === 'published') ||
      null;

    const selectedEvents = options.selectedEventIds?.length
      ? await this.resolveSelectedRelationEvents(projectId, options.selectedEventIds)
      : [];

    const docRes = await http.get(`/api/projects/${projectId}/documents`);
    const docList = this.unwrapPayload<DocumentItem[]>(docRes.data);

    const ragBaseURL = getRagOrchestratorBaseURL();
    const contextUrl = ragBaseURL
      ? `${ragBaseURL}/api/projects/${projectId}/context`
      : `/api/projects/${projectId}/context`;

    const response = await fetch(contextUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemPromptText: resolvedSystemPromptText,
        personaProfile: activePersona
          ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
          : '未配置人物设定',
        outlineSummary: workspace.knowledge.outlineSummary,
        chapters: (() => {
          const byNo = new Map<
            number,
            {
              chapterNo: number;
              title: string;
              summary: string;
              structuredMatchingText?: string;
            }
          >();
          for (const chapter of workspace.knowledge.chapters) {
            const structured = resolveWorkbenchStructuredInfo(
              chapter.chapterNo,
              workspace.knowledge.chapters,
              workspace.knowledge.workbenchStructuredByChapter
            );
            byNo.set(chapter.chapterNo, {
              chapterNo: chapter.chapterNo,
              title: chapter.title,
              summary: chapter.summary || chapter.content.slice(0, 160),
              structuredMatchingText: resolveEffectiveStructuredMatchingText(structured),
            });
          }
          for (const [key, draft] of Object.entries(
            workspace.knowledge.workbenchStructuredByChapter ?? {}
          )) {
            const chapterNo = Number(key);
            if (!Number.isFinite(chapterNo) || chapterNo <= 0 || byNo.has(chapterNo)) {
              continue;
            }
            byNo.set(chapterNo, {
              chapterNo,
              title: `第${chapterNo}章`,
              summary: '',
              structuredMatchingText: resolveEffectiveStructuredMatchingText(draft),
            });
          }
          return [...byNo.values()].sort((a, b) => a.chapterNo - b.chapterNo);
        })(),
        knowledgeDocuments: docList.map((doc) => ({
          docType: doc.docType ?? 'other',
          id: doc.id,
          title: doc.title,
          content: doc.content,
        })),
        chapterSummaryPromptCount: workspace.settings.chapterSummaryPromptCount,
        chapterSummaryMemoryCount:
          (workspace.settings as { chapterSummaryMemoryCount?: number })
            .chapterSummaryMemoryCount ?? 3,
        generationTemperature: workspace.settings.generationTemperature,
        contentSafetyScanEnabled: workspace.settings.contentSafetyScanEnabled !== false,
        contentSafetyCustomRules: Array.isArray(workspace.settings.contentSafetyCustomRules)
          ? workspace.settings.contentSafetyCustomRules
          : [],
        selectedRelationMemory: buildRelationMemoryBlock(selectedEvents),
        usedRelationEvents: selectedEvents,
        personas: buildPersonasContextPayload(workspace.personas),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || '同步项目上下文失败');
    }
  },

  async resolveSelectedRelationEvents(projectId: string, selectedEventIds: string[]) {
    const events = await this.getRelationEvents(projectId);
    const eventMap = new Map(events.map((event) => [event.id, event]));
    const resolved: UsedRelationEventItem[] = [];

    for (const eventId of [...new Set(selectedEventIds)]) {
      const event = eventMap.get(eventId);
      if (!event) {
        throw new Error(`未找到可用关系事件: ${eventId}`);
      }
      resolved.push({
        id: event.id,
        protagonist: event.protagonist,
        counterparty: event.counterparty,
        summary: event.summary,
        evidenceSnippet: event.evidenceSnippet,
        chapterNo: event.chapterNo,
      });
    }

    return resolved;
  },

  // SSE streaming generation for writing workbench
  async generateWriteOutlineSSE(
    projectId: string,
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords?: number;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    callbacks: {
      onStart?: (event: WriteChapterOutlineStartEvent) => void;
      onContent?: (text: string) => void;
      onEnd?: (result: WriteChapterOutlineResult) => void;
      onError?: (message: string) => void;
    },
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/write/outline`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify(task),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            outlineId?: string;
            outlineText?: string;
            basis?: WriteChapterOutlineBasis;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.({
                traceId: event.traceId || '',
                chapterNo: event.chapterNo ?? task.chapterNo,
                outlineId: event.outlineId || '',
                basis:
                  event.basis ??
                  ({
                    usedPersonaId: null,
                    outlineUsed: false,
                    recentChapterCount: 0,
                    usedRelationEvents: [],
                  } as WriteChapterOutlineBasis),
              });
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'end':
              callbacks.onEnd?.({
                traceId: event.traceId || '',
                outlineText: (event.outlineText || '').trim(),
                outlineId: event.outlineId || '',
                basis:
                  event.basis ??
                  ({
                    usedPersonaId: null,
                    outlineUsed: false,
                    recentChapterCount: 0,
                    usedRelationEvents: [],
                  } as WriteChapterOutlineBasis),
              });
              break;
            case 'error':
              callbacks.onError?.(event.data || '生成章节大纲失败');
              break;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    );
  },

  async generateDraftSSE(
    projectId: string,
    task: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords?: number;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    outline: {
      confirmedOutlineText: string;
      outlineId?: string;
      outlineTraceId?: string;
    },
    citations: CitationItem[],
    callbacks: SseCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    await this.syncProjectContext(projectId, {
      selectedEventIds: task.selectedEventIds,
    });

    const ragBaseURL = getRagOrchestratorBaseURL();
    const draftUrl = ragBaseURL ? `${ragBaseURL}/api/generate/draft` : '/api/generate/draft';

    await requestAuthorizedSse(
      draftUrl,
      {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          task,
          citations,
          confirmedOutlineText: outline.confirmedOutlineText,
          outlineId: outline.outlineId,
          outlineTraceId: outline.outlineTraceId,
        }),
        signal: options?.signal,
      },
      'lines',
      (dataLine) => {
        try {
          const data: SseEvent & {
            event: string;
            taskKey?: string;
            stage?: string;
            message?: string;
            currentStep?: number;
            totalSteps?: number;
          } = JSON.parse(dataLine);
          switch (data.event) {
            case 'start':
              callbacks.onStart?.(data.traceId, data.chapterNo);
              break;
            case 'retrieving':
            case 'building_prompt':
            case 'waiting_llm':
            case 'generating':
            case 'checking':
            case 'content_safety_scan':
            case 'content_safety_rewrite':
              callbacks.onPhase?.(data.event as GenerationPhase);
              break;
            case 'progress':
              if (data.traceId && data.taskKey && data.stage && data.message) {
                callbacks.onProgress?.({
                  traceId: data.traceId,
                  taskKey: data.taskKey,
                  stage: data.stage,
                  message: data.message,
                  currentStep: data.currentStep,
                  totalSteps: data.totalSteps,
                });
              }
              break;
            case 'content_replace':
              callbacks.onContentReplace?.((data.data || '').replace(/\\n/g, '\n'));
              break;
            case 'content':
              callbacks.onContent?.(data.data.replace(/\\n/g, '\n'));
              break;
            case 'end':
              callbacks.onEnd?.(
                data.traceId,
                data.citations,
                data.consistencyNotes,
                data.usedRelationEvents || [],
                {
                  finalText: data.finalText,
                  contentSafety: data.contentSafety,
                }
              );
              break;
            case 'error':
              callbacks.onError?.(data.data);
              break;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    );
  },

  async optimizeChapterPlanSSE(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
      existingSegmentDiagnoses?: string[];
      resumeFromSegmentIndex?: number;
    },
    callbacks: ChapterOptimizePlanCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/plan`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error' | 'stage';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            planId?: string;
            planText?: string;
            basis?: ChapterOptimizationBasis;
            optimizationMode?: 'single' | 'segmented';
            segmentTotal?: number;
            strategyLabel?: string;
            inputChapterChars?: number;
            segmentDiagnoses?: string[];
            stage?: ChapterOptimizeStage;
            segmentIndex?: number;
            retryCount?: number;
            failedSegmentIndex?: number;
            retryable?: boolean;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.({
                traceId: event.traceId || '',
                chapterNo: event.chapterNo ?? chapterNo,
                planId: event.planId || '',
                basis: event.basis ?? {
                  usedPersonaId: null,
                  outlineUsed: false,
                  chapterSummaryCount: 0,
                  usedRelationEvents: [],
                },
                optimizationMode: event.optimizationMode,
                segmentTotal: event.segmentTotal,
                strategyLabel: event.strategyLabel,
                inputChapterChars: event.inputChapterChars,
              });
              break;
            case 'stage':
              if (event.stage) {
                callbacks.onStage?.({
                  stage: event.stage,
                  segmentIndex: event.segmentIndex,
                  segmentTotal: event.segmentTotal,
                  retryCount: event.retryCount,
                });
              }
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'end': {
              const result: ChapterOptimizationPlanResult = {
                traceId: event.traceId || '',
                planText: (event.planText || '').trim(),
                planId: event.planId || '',
                basis:
                  event.basis ??
                  ({
                    usedPersonaId: null,
                    outlineUsed: false,
                    chapterSummaryCount: 0,
                    usedRelationEvents: [],
                  } as ChapterOptimizationBasis),
                optimizationMode: event.optimizationMode,
                segmentTotal: event.segmentTotal,
                strategyLabel: event.strategyLabel,
                segmentDiagnoses: event.segmentDiagnoses,
              };
              callbacks.onEnd?.(result);
              break;
            }
            case 'error':
              callbacks.onError?.(event.data || '生成优化方案失败', {
                failedSegmentIndex: event.failedSegmentIndex,
                segmentTotal: event.segmentTotal,
                segmentDiagnoses: event.segmentDiagnoses,
                retryable: event.retryable,
              });
              break;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    );
  },

  async optimizeChapterDraftSSE(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction: string;
      planText: string;
      planId?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
      segmentDiagnoses?: string[];
    },
    callbacks: ChapterOptimizeDraftCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/draft`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?:
              | 'start'
              | 'content'
              | 'content_replace'
              | 'end'
              | 'error'
              | 'segment_start'
              | 'stage'
              | 'progress';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            optimizationMode?: 'single' | 'segmented';
            segmentTotal?: number;
            strategyLabel?: string;
            stage?: ChapterOptimizeStage;
            segmentIndex?: number;
            taskKey?: string;
            message?: string;
            currentStep?: number;
            totalSteps?: number;
            finalDraftText?: string;
            contentSafety?: ContentSafetyScanResult;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.(event.traceId || '', event.chapterNo ?? chapterNo, {
                optimizationMode: event.optimizationMode,
                segmentTotal: event.segmentTotal,
                strategyLabel: event.strategyLabel,
              });
              break;
            case 'stage':
              if (event.stage) {
                callbacks.onStage?.({
                  stage: event.stage,
                  segmentIndex: event.segmentIndex,
                  segmentTotal: event.segmentTotal,
                });
              }
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'content_replace':
              callbacks.onContentReplace?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'progress':
              if (event.traceId && event.taskKey && event.stage && event.message) {
                callbacks.onProgress?.({
                  traceId: event.traceId,
                  taskKey: event.taskKey,
                  stage: event.stage,
                  message: event.message,
                  currentStep: event.currentStep,
                  totalSteps: event.totalSteps,
                });
              }
              break;
            case 'end':
              callbacks.onEnd?.({
                traceId: event.traceId || '',
                finalDraftText: event.finalDraftText,
                contentSafety: event.contentSafety,
              });
              break;
            case 'error':
              callbacks.onError?.(event.data || '优化正文生成失败');
              break;
            case 'segment_start': {
              let segData: { segmentIndex: number; totalSegments: number } | null = null;
              try {
                segData = JSON.parse(event.data || '{}');
              } catch {
                // skip malformed
              }
              if (segData) {
                callbacks.onSegmentStart?.(segData.segmentIndex, segData.totalSegments);
              }
              break;
            }
          }
        } catch {
          // skip malformed SSE events
        }
      }
    );
  },

  async applyChapterOptimization(
    projectId: string,
    chapterNo: number,
    payload: {
      draftText: string;
      expectedChapterUpdatedAt: string;
      planId?: string;
      preserveSummary?: boolean;
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/apply`,
      payload
    );
    return this.unwrapPayload<{ chapter: ChapterItem }>(response.data);
  },

  async startChapterPipeline(
    projectId: string,
    chapterNo: number,
    payload?: {
      preset?: 'full' | 'character_rules' | 'sensory_only';
      mode?: 'pipeline' | 'final-polish';
      configOverrides?: Partial<ChapterPipelineConfig>;
      selectedPersonaNames?: string[];
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/start`,
      payload ?? {}
    );
    return this.unwrapPayload<ChapterPipelineStartResult>(response.data);
  },

  async getChapterPipelineSession(projectId: string, chapterNo: number, sessionId: string) {
    const response = await http.get(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}`
    );
    return this.unwrapPayload<ChapterPipelineSessionView>(response.data);
  },

  async patchChapterPipelineSensoryOutline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: ChapterPipelineSensoryOutlinePatch
  ) {
    const response = await http.patch(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/sensory-outline`,
      payload
    );
    return this.unwrapPayload<ChapterPipelineSessionView>(response.data);
  },

  async patchChapterPipelineOutline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: ChapterPipelineOutlinePatch
  ) {
    const response = await http.patch(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/outline`,
      payload
    );
    return this.unwrapPayload<ChapterPipelineSessionView>(response.data);
  },

  async reviseChapterPipelineOutline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: ChapterPipelineOutlineReviseRequest
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/outline/revise`,
      payload
    );
    return this.unwrapPayload<ChapterPipelineOutlineReviseResult>(response.data);
  },

  async patchChapterPipelineVersion(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: { versionKey: ChapterPipelineVersionKey; text: string }
  ) {
    const response = await http.patch(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/version`,
      payload
    );
    return this.unwrapPayload<ChapterPipelineSessionView>(response.data);
  },

  async applyChapterPipeline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      useVersion?: 'afterRules' | 'final';
      draftTextOverride?: string;
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/apply`,
      payload
    );
    return this.unwrapPayload<{ chapter: ChapterItem }>(response.data);
  },

  async startComplianceCheck(projectId: string, chapterNo: number) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/start`,
      {}
    );
    return this.unwrapPayload<{ sessionId: string; chapterNo: number }>(response.data);
  },

  async getComplianceCheckSession(projectId: string, chapterNo: number) {
    const response = await http.get(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/session`
    );
    return this.unwrapPayload<ComplianceCheckSessionView>(response.data);
  },

  async patchComplianceOutline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: {
      required: PipelineOutlineItem[];
      suggested: PipelineOutlineItem[];
      confirmed: boolean;
    }
  ) {
    const response = await http.patch(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/${sessionId}/outline`,
      payload
    );
    return this.unwrapPayload<ComplianceCheckSessionView>(response.data);
  },

  async reviseComplianceOutline(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: {
      mode?: 'recheck' | 'revise';
      currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
      userFeedback?: string;
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/${sessionId}/outline/revise`,
      payload
    );
    return this.unwrapPayload<{
      required: PipelineOutlineItem[];
      suggested: PipelineOutlineItem[];
      revisionRound: number;
    }>(response.data);
  },

  async applyComplianceCheck(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    payload: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      draftTextOverride?: string;
      forceApply?: boolean;
    }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/${sessionId}/apply`,
      payload
    );
    return this.unwrapPayload<{ chapter: ChapterItem }>(response.data);
  },

  async runComplianceCheckPhaseSSE(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    phase: 'outline' | 'rewrite',
    callbacks: ChapterPipelineRunCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/compliance-check/${sessionId}/run/${phase}`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify({}),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error' | 'stage';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            stage?: ChapterPipelineStage;
            segmentIndex?: number;
            segmentTotal?: number;
            versionText?: string;
            qualityStatus?: FinalPolishQualityStatus;
            residualIssues?: PipelineRuleIssue[];
            outline?: ComplianceOutlineState;
            code?: number;
          };

          switch (event.event) {
            case 'start':
              callbacks.onStart?.({
                traceId: event.traceId || '',
                chapterNo: event.chapterNo ?? chapterNo,
                stage: event.stage || 'compliance_outline',
              });
              break;
            case 'stage':
              callbacks.onStage?.({
                stage: event.stage || 'compliance_outline',
                segmentIndex: event.segmentIndex,
                segmentTotal: event.segmentTotal,
              });
              break;
            case 'content': {
              const piece = (event.data || '').replace(/\\n/g, '\n');
              callbacks.onContent?.(piece);
              break;
            }
            case 'end':
              callbacks.onEnd?.(event);
              break;
            case 'error':
              callbacks.onError?.(event.data || '合规检验失败');
              break;
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    );
  },

  async runChapterPipelineModuleSSE(
    projectId: string,
    chapterNo: number,
    sessionId: string,
    module: ChapterPipelineRunModule,
    payload: { issueId?: string; forceRegenerate?: boolean } | undefined,
    callbacks: ChapterPipelineRunCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/pipeline/${sessionId}/run/${module}`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error' | 'stage';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            stage?: ChapterPipelineStage;
            segmentIndex?: number;
            segmentTotal?: number;
            versionText?: string;
            versionKey?: string;
            characterOutline?: ChapterPipelineSessionView['characterOutline'];
            characterTraitsOutline?: ChapterPipelineSessionView['characterTraitsOutline'];
            sensoryOutline?: ChapterPipelineSessionView['sensoryOutline'];
            ruleIssues?: PipelineRuleIssue[];
            homogenizationReport?: PipelineHomogenizationIssue[];
            gateRequired?: boolean;
            gate?: string;
            currentModule?: number | 'done';
          };

          switch (event.event) {
            case 'start':
              callbacks.onStart?.({
                traceId: event.traceId || '',
                chapterNo: event.chapterNo ?? chapterNo,
                stage: event.stage || 'pipeline_character',
              });
              break;
            case 'stage':
              callbacks.onStage?.({
                stage: event.stage || 'pipeline_character',
                segmentIndex: event.segmentIndex,
                segmentTotal: event.segmentTotal,
              });
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'end':
              callbacks.onEnd?.(event);
              break;
            case 'error':
              callbacks.onError?.(event.data || '分步精修执行失败');
              break;
          }
        } catch {
          // skip malformed SSE
        }
      }
    );
  },

  async checkChapterOptimizationTypos(
    projectId: string,
    chapterNo: number,
    payload: { draftText: string }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/typo-check`,
      payload
    );
    return this.unwrapPayload<ChapterOptimizationTypoCheckResult>(response.data);
  },

  async fixChapterOptimizationTyposSSE(
    projectId: string,
    chapterNo: number,
    payload: { draftText: string; issues?: ChapterTypoIssue[] },
    callbacks: ChapterOptimizeTypoFixCallbacks,
    options?: SseStreamOptions
  ): Promise<void> {
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/typo-fix`;

    await requestAuthorizedSse(
      url,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: options?.signal,
      },
      'segments',
      (dataPart) => {
        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'content_replace' | 'end' | 'error' | 'progress';
            data?: string;
            traceId?: string;
            appliedIssueCount?: number;
            autoCorrected?: boolean;
            taskKey?: string;
            stage?: string;
            message?: string;
            currentStep?: number;
            totalSteps?: number;
            finalDraftText?: string;
            contentSafety?: ContentSafetyScanResult;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.(event.traceId || '');
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'content_replace':
              callbacks.onContentReplace?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'progress':
              if (event.traceId && event.taskKey && event.stage && event.message) {
                callbacks.onProgress?.({
                  traceId: event.traceId,
                  taskKey: event.taskKey,
                  stage: event.stage,
                  message: event.message,
                  currentStep: event.currentStep,
                  totalSteps: event.totalSteps,
                });
              }
              break;
            case 'end':
              callbacks.onEnd?.({
                traceId: event.traceId || '',
                appliedIssueCount: event.appliedIssueCount ?? 0,
                autoCorrected: event.autoCorrected ?? true,
                finalDraftText: event.finalDraftText,
                contentSafety: event.contentSafety,
              });
              break;
            case 'error':
              callbacks.onError?.(event.data || '错字自动修正失败');
              break;
          }
        } catch {
          // skip malformed SSE events
        }
      }
    );
  },

  async exportProjectChaptersTxt(projectId: string): Promise<Blob> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const baseURL = getApiBaseURL();
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/export?format=txt`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
      }
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `导出章节失败: ${response.statusText}`);
    }

    return response.blob();
  },

  async importChapterPreview(projectId: string, content: string) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/import/preview`,
      { content }
    );
    return this.unwrapPayload<{
      totalChars: number;
      detectedCount: number;
      chapters: Array<{
        chapterNo: number;
        title: string;
        contentLength: number;
        contentPreview: string;
      }>;
    }>(response.data);
  },

  async importChapterConfirm(
    projectId: string,
    content: string,
    options?: { chapterNos?: number[]; autoExtractRelationEvents?: boolean }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/import/confirm`,
      {
        content,
        chapterNos: options?.chapterNos,
        autoExtractRelationEvents: options?.autoExtractRelationEvents,
      }
    );
    return this.unwrapPayload<{
      importedCount: number;
      chapters: ChapterItem[];
      personaBootstrap: ChapterImportPersonaBootstrap;
    }>(response.data);
  },

  // Document helper methods
  async getDocument(id: string) {
    const response = await http.get(`/api/documents/${id}`);
    return response.data;
  },

  async updateDocument(
    id: string,
    payload: { title?: string; content?: string; docType?: DocType }
  ) {
    const response = await http.put(`/api/documents/${id}`, payload);
    return response.data;
  },

  async deleteDocument(id: string) {
    await http.delete(`/api/documents/${id}`);
  },

  async getDocumentVersions(id: string) {
    const response = await http.get(`/api/documents/${id}/versions`);
    return response.data;
  },
};

// Export types from shared-types for convenience
export type { components, paths };

// Common types
export type User = components['schemas']['User'];
export type Project = components['schemas']['Project'];
export type Document = components['schemas']['Document'];
export type Chunk = components['schemas']['Chunk'];
export type GenerationTrace = components['schemas']['GenerationTrace'];
export type PromptConfig = components['schemas']['PromptConfig'];
export type Envelope<T = unknown> = components['schemas']['Envelope'] & { data: T };

// Legacy types for backward compatibility
export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DocType = 'persona_card' | 'world_setting' | 'reference' | 'lore' | 'other';

export interface DocumentItem {
  id: string;
  projectId: string;
  title: string;
  content: string;
  docType?: DocType;
  indexStatus: 'pending' | 'indexing' | 'completed' | 'failed';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterPendingAction {
  type: 'persona' | 'relationEvents';
  label: string;
  estimatedTokens: number;
}

export interface ChapterUpsertResult extends ChapterItem {
  contentChanged?: boolean;
  pendingActions?: ChapterPendingAction[];
}

export interface WriteContextReadiness {
  chapterNo: number;
  priorChapterExists: boolean;
  priorChaptersMissingSummary: number[];
  recommendedActions: Array<'batch_summarize'>;
}

export interface PreviewRetrievalItem {
  id: string;
  pool:
    | 'prior_chapter_tail'
    | 'persona_snapshots'
    | 'persona_card'
    | 'other_docs'
    | 'recent_chapters'
    | 'memory_chapters';
  title: string;
  preview: string;
  score?: number;
  selected: boolean;
  meta?: Record<string, unknown>;
}

export interface PreviewRetrievalResult {
  items: PreviewRetrievalItem[];
  tokenBudget: number;
  tokenUsed: number;
  query: string;
}

export interface ChunkItem {
  id: string;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DocumentVersionItem {
  version: number;
  title: string;
  content: string;
  createdAt: string;
}

export type ProjectSettings = components['schemas']['ProjectSettings'];
export type ProjectContentSafetyRule = components['schemas']['ProjectContentSafetyRule'];

export interface PersonaChapterStateRecord {
  chapterNo: number;
  appeared: boolean;
  snapshot: PersonaSnapshot;
  summaryLine: string;
  updatedAt: string;
}

export interface PersonaSnapshot {
  clothing?: string;
  appearance?: string;
  status?: string;
  location?: string;
  possessions?: string;
}

export interface PersonaItem {
  id: string;
  name: string;
  profile: string;
  state: string;
  status: 'draft' | 'published';
  relationEventIds: string[];
  appearedChapterNos: number[];
  lastAppearedChapterNo: number | null;
  chapterStates?: PersonaChapterStateRecord[];
  createdAt: string;
  updatedAt: string;
}

export function buildPersonasContextPayload(personas: PersonaItem[]) {
  return personas.map((persona) => ({
    name: persona.name,
    profile: persona.profile,
    state: persona.state,
    status: persona.status,
    chapterStates: persona.chapterStates,
  }));
}

export type ChapterSummarySource = 'llm' | 'fallback';

export interface ChapterItem {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
  summarySource?: ChapterSummarySource;
  summaryUpdatedAt?: string;
  updatedAt: string;
  structuredInfo?: ChapterStructuredInfo;
}

export interface ChapterStructuredInfo {
  matchingText: string;
  keywords?: string[];
  personaKeywordSupplements?: string[];
  narrativeSummary?: string;
  parseSource?: 'workbench' | 'chapter';
  parsedAt?: string;
  lastError?: string;
}

export interface StructuredInfoParseResult {
  chapter: ChapterItem;
  structuredInfo?: ChapterStructuredInfo;
}

export type ChapterPipelineStage =
  | 'pipeline_character_outline'
  | 'pipeline_character'
  | 'pipeline_character_traits_outline'
  | 'pipeline_character_traits'
  | 'pipeline_sensory_outline'
  | 'pipeline_sensory_rewrite'
  | 'pipeline_rules_scan'
  | 'pipeline_rules_fix'
  | 'pipeline_homogenization_scan'
  | 'pipeline_homogenization_rewrite'
  | 'pipeline_final_polish_done'
  | 'compliance_outline'
  | 'compliance_rewrite'
  | 'compliance_rewrite_segment'
  | 'compliance_rescan'
  | 'draft_segment'
  | 'merge_validation';

export type FinalPolishQualityStatus = 'passed' | 'passed_with_warnings' | 'blocked';

export interface ComplianceOutlineState {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  userConfirmed: boolean;
  revisionRound: number;
  confirmedAt?: string;
}

export interface ComplianceCheckSessionView {
  sessionId: string;
  projectId: string;
  chapterNo: number;
  status: string;
  sourceText: string;
  outline?: ComplianceOutlineState;
  versionText?: string;
  residualIssues?: PipelineRuleIssue[];
  qualityStatus?: FinalPolishQualityStatus;
  traceIds: Record<string, string | undefined>;
  createdAt: string;
  updatedAt: string;
}

export interface FinalPolishResult {
  fingerprint: string;
  versionText: string;
  residualIssues: PipelineRuleIssue[];
  qualityStatus: FinalPolishQualityStatus;
  traceIds: Record<string, string>;
  createdAt: string;
  cached?: boolean;
}

export type ChapterPipelineRunModule =
  | 'character-outline'
  | 'character'
  | 'character-traits-outline'
  | 'character-traits'
  | 'sensory-outline'
  | 'sensory-rewrite'
  | 'rules-scan'
  | 'rules-fix'
  | 'homogenization'
  | 'homogenization-scan'
  | 'homogenization-rewrite'
  | 'run-all'
  | 'final-polish';

export interface ChapterPipelineConfig {
  pipelinePreset: 'full' | 'character_rules' | 'sensory_only';
  pipelineSkipSensoryOutlineReview: boolean;
  pipelineSkipCharacterOutlineReview: boolean;
  pipelineSkipCharacterTraitsOutlineReview: boolean;
  pipelineCharacterTraitsEnabled: boolean;
  pipelineRulesFixMode: 'auto' | 'semi' | 'manual';
  pipelineHomogenizationEnabled: boolean;
  pipelineHomogenizationPriorChapterCount: number;
  pipelineEnabledModules: number[];
}

export type ChapterPipelineOutlineType = 'character' | 'character-traits' | 'sensory';

export type ChapterPipelineVersionKey =
  | 'afterCharacter'
  | 'afterCharacterTraits'
  | 'afterSensory'
  | 'afterRules'
  | 'final';

export interface PipelineOutlineItem {
  id: string;
  text: string;
  priority: 'required' | 'suggested';
  contentWarnings?: string[];
  personaId?: string;
  personaName?: string;
  featureRef?: string;
  anchorHint?: string;
}

export interface PipelineOutlineState {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  userConfirmed: boolean;
  revisionRound: number;
}

export interface PipelineRuleIssue {
  id: string;
  category: string;
  text: string;
  context: string;
  fixStrategy: 'auto' | 'ai_segment' | 'manual';
  startOffset: number;
  endOffset: number;
  fixed?: boolean;
}

export interface PipelineHomogenizationIssue {
  id: string;
  text: string;
  priorChapterNo: number;
  suggestion: string;
}

export interface ProtagonistUnlockRule {
  abilityKey: string;
  unlockAtChapter?: number;
  unlockAfterCondition?: string;
  descriptionForPrompt: string;
}

export interface ChapterPipelineStartResult {
  sessionId: string;
  chapterNo: number;
  config: ChapterPipelineConfig;
}

export interface ChapterPipelineSensoryOutlinePatch {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  confirmed: boolean;
}

export interface ChapterPipelineOutlinePatch extends ChapterPipelineSensoryOutlinePatch {
  outlineType: ChapterPipelineOutlineType;
}

export type ChapterPipelineOutlineReviseMode = 'recheck' | 'revise';

export interface ChapterPipelineOutlineReviseRequest {
  outlineType: ChapterPipelineOutlineType;
  mode?: ChapterPipelineOutlineReviseMode;
  currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
  userFeedback?: string;
}

export interface ChapterPipelineOutlineReviseResult {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  revisionRound: number;
}

export interface ChapterPipelineSessionView {
  sessionId: string;
  chapterNo: number;
  config: ChapterPipelineConfig;
  currentModule: number | 'done';
  versions: {
    original?: string;
    afterCharacter?: string;
    afterCharacterTraits?: string;
    afterSensory?: string;
    afterRules?: string;
    final?: string;
  };
  characterOutline?: PipelineOutlineState;
  characterTraitsOutline?: PipelineOutlineState;
  sensoryOutline?: PipelineOutlineState;
  selectedPersonaNames?: string[];
  ruleIssues?: PipelineRuleIssue[];
  homogenizationReport?: PipelineHomogenizationIssue[];
  sourceUpdatedAt: string;
  finalPolishResult?: FinalPolishResult;
}

export interface ChapterPipelineRunCallbacks {
  onStart?: (event: { traceId: string; chapterNo: number; stage: ChapterPipelineStage }) => void;
  onStage?: (event: {
    stage: ChapterPipelineStage;
    segmentIndex?: number;
    segmentTotal?: number;
  }) => void;
  onContent?: (text: string) => void;
  onEnd?: (event: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

export function isTerminalChapterPipelineRunEnd(
  module: ChapterPipelineRunModule,
  event: { gateRequired?: boolean; currentModule?: number | 'done' }
): boolean {
  if (module !== 'run-all') {
    return true;
  }
  return event.gateRequired === true || event.currentModule === 'done';
}

export function formatPipelineStageLabel(
  stage: ChapterPipelineStage,
  segmentIndex?: number,
  segmentTotal?: number
): string {
  switch (stage) {
    case 'pipeline_character_outline':
      return '生成角色调整大纲…';
    case 'pipeline_character':
      return '角色调整中…';
    case 'pipeline_character_traits_outline':
      return '生成角色特征润色大纲…';
    case 'pipeline_character_traits':
      return '角色特征润色中…';
    case 'pipeline_sensory_outline':
      return '生成感官优化大纲…';
    case 'pipeline_sensory_rewrite':
      return '感官优化改写中…';
    case 'pipeline_rules_scan':
      return '规则扫描中…';
    case 'pipeline_rules_fix':
      return segmentIndex && segmentTotal
        ? `规则修复 ${segmentIndex}/${segmentTotal}…`
        : '规则修复中…';
    case 'pipeline_homogenization_scan':
      return '同质化检测中…';
    case 'pipeline_homogenization_rewrite':
      return '同质化改写中…';
    case 'pipeline_final_polish_done':
      return '终稿已生成，等待审核';
    case 'compliance_outline':
      return '生成合规大纲…';
    case 'compliance_rewrite':
      return '合规改写中…';
    case 'compliance_rewrite_segment':
      return segmentIndex && segmentTotal
        ? `合规改写分段 ${segmentIndex}/${segmentTotal}…`
        : '合规改写分段中…';
    case 'compliance_rescan':
      return '硬规则复扫中…';
    case 'draft_segment':
      return segmentIndex && segmentTotal
        ? `分段生成 ${segmentIndex}/${segmentTotal}`
        : '分段生成中…';
    case 'merge_validation':
      return '合并校验中…';
    default:
      return '处理中…';
  }
}

export interface ChapterOptimizationBasis {
  usedPersonaId: string | null;
  outlineUsed: boolean;
  chapterSummaryCount: number;
  usedRelationEvents: UsedRelationEventItem[];
}

export interface ChapterOptimizationPlanResult {
  planText: string;
  planId: string;
  traceId: string;
  basis: ChapterOptimizationBasis;
  optimizationMode?: 'single' | 'segmented';
  segmentTotal?: number;
  strategyLabel?: string;
  segmentDiagnoses?: string[];
}

export type ChapterOptimizeStage =
  | 'segment_diagnosis'
  | 'plan_synthesis'
  | 'draft_segment'
  | 'merge_validation'
  | 'content_safety_scan'
  | 'content_safety_rewrite';

export const DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE = 3000;

export function resolveChapterOptimizeStrategyLabel(
  contentLength: number,
  segmentCharSize = DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE
): string {
  if (segmentCharSize === 0) {
    return contentLength > 2800 ? '整章优化（未按字数分段）' : '整章优化';
  }
  if (contentLength <= 2800) {
    return '整章优化';
  }
  const count = Math.ceil(contentLength / segmentCharSize);
  return `${count} 段优化（约 ${segmentCharSize} 字/段）`;
}

export function formatChapterOptimizeStageLabel(
  stage: ChapterOptimizeStage,
  segmentIndex?: number,
  segmentTotal?: number,
  retryCount?: number
): string {
  const retrySuffix =
    typeof retryCount === 'number' && retryCount > 0 ? `（重试 ${retryCount}）` : '';
  switch (stage) {
    case 'segment_diagnosis':
      return segmentIndex && segmentTotal
        ? `分段诊断 ${segmentIndex}/${segmentTotal}${retrySuffix}`
        : `分段诊断${retrySuffix}`;
    case 'plan_synthesis':
      return retrySuffix ? `方案汇总${retrySuffix}` : '方案汇总';
    case 'draft_segment':
      return segmentIndex && segmentTotal
        ? `正文第 ${segmentIndex}/${segmentTotal} 段`
        : '正文分段生成';
    case 'merge_validation':
      return '合并校验';
    case 'content_safety_scan':
      return '正在执行内容安全扫描…';
    case 'content_safety_rewrite':
      return retrySuffix ? `正在批量重写命中句子${retrySuffix}` : '正在批量重写命中句子…';
    default:
      return '处理中';
  }
}

export interface WriteChapterOutlineBasis {
  usedPersonaId: string | null;
  outlineUsed: boolean;
  recentChapterCount: number;
  usedRelationEvents: UsedRelationEventItem[];
}

export interface WriteChapterOutlineResult {
  outlineText: string;
  outlineId: string;
  traceId: string;
  basis: WriteChapterOutlineBasis;
}

export interface WriteChapterOutlineStartEvent {
  traceId: string;
  chapterNo: number;
  outlineId: string;
  basis: WriteChapterOutlineBasis;
}

export interface ChapterOptimizeSegmentRecovery {
  failedSegmentIndex?: number;
  segmentTotal?: number;
  segmentDiagnoses?: string[];
  retryable?: boolean;
}

export interface ChapterOptimizePlanCallbacks {
  onStart?: (payload: {
    traceId: string;
    chapterNo: number;
    planId: string;
    basis: ChapterOptimizationBasis;
    optimizationMode?: 'single' | 'segmented';
    segmentTotal?: number;
    strategyLabel?: string;
    inputChapterChars?: number;
  }) => void;
  onStage?: (payload: {
    stage: ChapterOptimizeStage;
    segmentIndex?: number;
    segmentTotal?: number;
    retryCount?: number;
  }) => void;
  onContent?: (text: string) => void;
  onEnd?: (result: ChapterOptimizationPlanResult) => void;
  onError?: (message: string, recovery?: ChapterOptimizeSegmentRecovery) => void;
}

export interface ChapterOptimizeDraftCallbacks {
  onStart?: (
    traceId: string,
    chapterNo: number,
    meta?: {
      optimizationMode?: 'single' | 'segmented';
      segmentTotal?: number;
      strategyLabel?: string;
    }
  ) => void;
  onStage?: (payload: {
    stage: ChapterOptimizeStage;
    segmentIndex?: number;
    segmentTotal?: number;
  }) => void;
  onContent?: (text: string) => void;
  onContentReplace?: (text: string) => void;
  onProgress?: (event: AiTaskProgressEvent) => void;
  onEnd?: (payload: {
    traceId: string;
    finalDraftText?: string;
    contentSafety?: ContentSafetyScanResult;
  }) => void;
  onError?: (message: string) => void;
  onSegmentStart?: (segmentIndex: number, totalSegments: number) => void;
}

export interface ChapterTypoIssue {
  id: string;
  original: string;
  suggestion: string;
  context?: string;
  reason?: string;
}

export interface ChapterOptimizationTypoCheckResult {
  issues: ChapterTypoIssue[];
  traceId: string;
  issueCount: number;
}

export interface ChapterOptimizeTypoFixCallbacks {
  onStart?: (traceId: string) => void;
  onContent?: (text: string) => void;
  onContentReplace?: (text: string) => void;
  onProgress?: (event: AiTaskProgressEvent) => void;
  onEnd?: (payload: {
    traceId: string;
    appliedIssueCount: number;
    autoCorrected: boolean;
    finalDraftText?: string;
    contentSafety?: ContentSafetyScanResult;
  }) => void;
  onError?: (message: string) => void;
}

export interface KnowledgeItem {
  outlineSummary: string;
  chapters: ChapterItem[];
  workbenchStructuredByChapter?: Record<string, ChapterStructuredInfo>;
  indexVersion: number;
  lastIndexedAt: string | null;
}

export interface IndexJob {
  id: string;
  projectId: string;
  mode: 'full' | 'incremental';
  status: 'processing' | 'completed' | 'failed';
  totalChapters: number;
  processedChapters: number;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface SummaryJob {
  id: string;
  projectId: string;
  scope: 'single' | 'batch';
  chapterNo: number | null;
  status: 'processing' | 'completed' | 'failed';
  totalChapters: number;
  processedChapters: number;
  chapterNos: number[];
  summaries: Array<{
    chapterNo: number;
    summary: string;
    summarySource: ChapterSummarySource;
  }>;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ChapterSummaryMemoryRebuildResult {
  source: 'existing' | 'content_fallback';
  total: number;
  indexed: number;
  failed: number;
  skipped: number;
  chapters: Array<{
    chapterNo: number;
    status: 'indexed' | 'skipped' | 'failed';
    summaryChars?: number;
    summarySource?: ChapterSummarySource;
    error?: string;
  }>;
}

export interface ChapterRelationEventGenerateResult {
  chapterNo: number;
  removedCount: number;
  createdCount: number;
  skippedCount: number;
  events: RelationEventItem[];
}

export interface WriteResult {
  draftText: string;
  reasoningBrief: string;
  citations: Array<{ sourceType: string; sourceId: string; snippet: string }>;
  consistencyNotes: Array<{ level: 'info' | 'warning'; message: string }>;
  usedRelationEvents?: UsedRelationEventItem[];
  autoUpdates: {
    chapterUpdated: boolean;
    outlineUpdated: boolean;
    personaUpdated: boolean;
    updateLine: string;
  };
  context: {
    projectId: string;
    chapterNo: number;
    usedPersonaId: string | null;
    outlineUsed: boolean;
    recentChapterCount: number;
    targetWords: number | null;
  };
}

export interface ProjectExportBundle {
  project: ProjectItem;
  exportedAt: string;
  settings: {
    systemPromptText: string;
    activePersonaId: string | null;
    personas: PersonaItem[];
  };
  summary: {
    outlineSummary: string;
    chapterCount: number;
    chapters: Array<{ chapterNo: number; title: string; summary: string; updatedAt: string }>;
  };
}

export interface PromptTemplateItem {
  id: string;
  projectId: string;
  name: string;
  category: string;
  content: string;
  version: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptConfigVersionItem {
  version: number;
  content: string;
  createdAt: string;
  isPublished: boolean;
}

export interface TaskPromptListItem {
  templateKey: string;
  name: string;
  defaultText: string;
  draftText: string;
  publishedText: string;
  version: number;
  hasCustomDraft: boolean;
  hasCustomPublished: boolean;
  updatedAt?: string;
}

export interface TaskPromptPublishResult {
  templateKey: string;
  version: number;
  publishedAt: string;
}

export interface TaskPromptRollbackResult {
  templateKey: string;
  version: number;
  rolledBackAt: string;
}

export type PersonaIdentityRelationItem = components['schemas']['PersonaIdentityRelation'];
export type ProjectWorkspaceSnapshot = components['schemas']['ProjectWorkspaceSnapshot'];

export interface RelationEventItem {
  id: string;
  projectId: string;
  protagonist: string;
  counterparty: string;
  actors: string[];
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
  protagonistPersonaId: string | null;
  counterpartyPersonaId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ChapterImportPersonaBootstrap {
  createdPersonaCount: number;
  createdRelationEventCount: number;
  suspectedNameConflicts: string[];
  createdPersonas: Array<{ id: string; name: string }>;
}

export interface RelationEventInput {
  protagonist?: string;
  counterparty: string;
  actors?: string[];
  summary: string;
  evidenceSnippet?: string;
  chapterNo?: number | null;
}

export interface UsedRelationEventItem {
  id: string;
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo?: number | null;
}

function buildRelationMemoryBlock(events: UsedRelationEventItem[]): string {
  if (events.length === 0) {
    return '';
  }

  const lines = events.map((event, index) => {
    const chapterLabel =
      typeof event.chapterNo === 'number' && event.chapterNo > 0
        ? `第${event.chapterNo}章`
        : '章节未标注';
    const pair = `${event.protagonist}-${event.counterparty}`;
    let line = `${index + 1}. [${chapterLabel}][${pair}] ${event.summary}`;
    if (event.evidenceSnippet?.trim()) {
      line += `\n   证据：${event.evidenceSnippet.trim()}`;
    }
    return line;
  });

  return [
    '【用户选择的关系事件（既定事实）】',
    lines.join('\n'),
    '',
    '【执行约束】',
    '- 上述事件视为已发生事实，不得无因否定',
    '- 如需关系反转，必须写出过渡情节',
  ].join('\n');
}
