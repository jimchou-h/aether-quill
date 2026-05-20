/**
 * Aether Quill API Client
 * Auto-generated from OpenAPI specification
 *
 * This client provides type-safe access to all API endpoints
 * using types generated from the OpenAPI specification.
 */

import axios, { AxiosInstance } from 'axios';
import type { paths, components } from '@aether-quill/shared-types';

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
  | 'checking';

export interface SsePhaseEvent {
  event: GenerationPhase;
  traceId?: string;
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
  onContent?: (text: string) => void;
  onEnd?: (
    traceId: string,
    citations: CitationItem[],
    consistencyNotes: ConsistencyNote[],
    usedRelationEvents: UsedRelationEventItem[]
  ) => void;
  onError?: (error: string) => void;
}

export interface ProjectWritingStats {
  totalCharCount: number;
  chapterCharCounts: Array<{ chapterNo: number; charCount: number }>;
  totalTokens: number;
  generationTotal: number;
  generationCompleted: number;
  generationFailed: number;
}

// Create axios instance
const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
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
      latestIndexJob: IndexJob | null;
      latestSummaryJob: SummaryJob | null;
    }>(response.data);
  },

  async getProjectExport(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/export`);
    return this.unwrapPayload<ProjectExportBundle>(response.data);
  },

  async getSettings(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/settings`);
    return this.unwrapPayload<ProjectSettings>(response.data);
  },

  async getProjectStats(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/stats`);
    return this.unwrapPayload<ProjectWritingStats>(response.data);
  },

  async updateSettings(projectId: string, payload: components['schemas']['ProjectSettingsUpdate']) {
    const response = await http.put(`/api/projects/${projectId}/settings`, payload);
    return this.unwrapPayload<ProjectSettings>(response.data);
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
    }
  ): Promise<void> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();
    const token = localStorage.getItem('token');

    const response = await fetch(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/after-save`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ actions }),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(body || response.statusText);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6)) as {
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
    }
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
      projectId: string
    ): Promise<ResponseData<'/api/projects/{id}/prompt-config/publish', 'post'>> {
      const response = await http.post(`/api/projects/${projectId}/prompt-config/publish`);
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
        systemPromptText: workspace.settings.systemPromptText,
        personaProfile: activePersona
          ? `${activePersona.name}\n人物设定：${activePersona.profile}\n当前状态：${activePersona.state}`
          : '未配置人物设定',
        outlineSummary: workspace.knowledge.outlineSummary,
        chapters: workspace.knowledge.chapters.map((chapter) => ({
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          summary: chapter.summary || chapter.content.slice(0, 160),
          structuredMatchingText: chapter.structuredInfo?.matchingText?.trim(),
        })),
        knowledgeDocuments: docList.map((doc) => ({
          docType: doc.docType ?? 'other',
          id: doc.id,
          title: doc.title,
          content: doc.content,
        })),
        chapterSummaryPromptCount: workspace.settings.chapterSummaryPromptCount,
        chapterSummaryMemoryCount:
          (workspace.settings as { chapterSummaryMemoryCount?: number }).chapterSummaryMemoryCount ??
          3,
        generationTemperature: workspace.settings.generationTemperature,
        selectedRelationMemory: buildRelationMemoryBlock(selectedEvents),
        usedRelationEvents: selectedEvents,
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
    citations: CitationItem[],
    callbacks: SseCallbacks
  ): Promise<void> {
    await this.syncProjectContext(projectId, {
      selectedEventIds: task.selectedEventIds,
    });

    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const ragBaseURL = getRagOrchestratorBaseURL();
    const draftUrl = ragBaseURL ? `${ragBaseURL}/api/generate/draft` : '/api/generate/draft';

    const response = await fetch(draftUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId, task, citations }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
      }
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `Generation failed: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reading = true;

    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data: SseEvent = JSON.parse(line.slice(6));
            switch (data.event) {
              case 'start':
                callbacks.onStart?.(data.traceId, data.chapterNo);
                break;
              case 'retrieving':
              case 'building_prompt':
              case 'waiting_llm':
              case 'generating':
              case 'checking':
                callbacks.onPhase?.(data.event);
                break;
              case 'content':
                callbacks.onContent?.(data.data.replace(/\\n/g, '\n'));
                break;
              case 'end':
                callbacks.onEnd?.(
                  data.traceId,
                  data.citations,
                  data.consistencyNotes,
                  data.usedRelationEvents || []
                );
                reading = false;
                break;
              case 'error':
                callbacks.onError?.(data.data);
                reading = false;
                break;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    }
  },

  async optimizeChapterPlanSSE(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    callbacks: ChapterOptimizePlanCallbacks
  ): Promise<void> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/plan`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
      }
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `生成优化方案失败: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reading = true;

    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataPart = trimmed.replace(/^data:\s*/, '');
        if (!dataPart) {
          continue;
        }

        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error';
            data?: string;
            traceId?: string;
            chapterNo?: number;
            planId?: string;
            planText?: string;
            basis?: ChapterOptimizationBasis;
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
              });
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
              };
              callbacks.onEnd?.(result);
              reading = false;
              break;
            }
            case 'error':
              callbacks.onError?.(event.data || '生成优化方案失败');
              reading = false;
              break;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
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
    },
    callbacks: ChapterOptimizeDraftCallbacks
  ): Promise<void> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/draft`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
      }
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `优化正文生成失败: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reading = true;

    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataPart = trimmed.replace(/^data:\s*/, '');
        if (!dataPart) {
          continue;
        }

        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error' | 'segment_start';
            data?: string;
            traceId?: string;
            chapterNo?: number;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.(event.traceId || '', event.chapterNo || chapterNo);
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'end':
              callbacks.onEnd?.(event.traceId || '');
              reading = false;
              break;
            case 'error':
              callbacks.onError?.(event.data || '优化正文生成失败');
              reading = false;
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
    }
  },

  async applyChapterOptimization(
    projectId: string,
    chapterNo: number,
    payload: { draftText: string; expectedChapterUpdatedAt: string; planId?: string }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/apply`,
      payload
    );
    return this.unwrapPayload<{ chapter: ChapterItem }>(response.data);
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
    callbacks: ChapterOptimizeTypoFixCallbacks
  ): Promise<void> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
    const url = `${baseURL}/api/projects/${projectId}/knowledge/chapters/${chapterNo}/optimize/typo-fix`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
      }
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || `错字自动修正失败: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reading = true;

    while (reading) {
      const { done, value } = await reader.read();
      if (done) {
        reading = false;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataPart = trimmed.replace(/^data:\s*/, '');
        if (!dataPart) {
          continue;
        }

        try {
          const event = JSON.parse(dataPart) as {
            event?: 'start' | 'content' | 'end' | 'error';
            data?: string;
            traceId?: string;
            appliedIssueCount?: number;
            autoCorrected?: boolean;
          };
          switch (event.event) {
            case 'start':
              callbacks.onStart?.(event.traceId || '');
              break;
            case 'content':
              callbacks.onContent?.((event.data || '').replace(/\\n/g, '\n'));
              break;
            case 'end':
              callbacks.onEnd?.({
                traceId: event.traceId || '',
                appliedIssueCount: event.appliedIssueCount ?? 0,
                autoCorrected: event.autoCorrected ?? true,
              });
              reading = false;
              break;
            case 'error':
              callbacks.onError?.(event.data || '错字自动修正失败');
              reading = false;
              break;
          }
        } catch {
          // skip malformed SSE events
        }
      }
    }
  },

  async exportProjectChaptersTxt(projectId: string): Promise<Blob> {
    const { useAuthStore } = await import('../stores/auth');
    await useAuthStore().ensureFreshSession();

    const token = localStorage.getItem('token');
    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
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
    options?: { chapterNos?: number[] }
  ) {
    const response = await http.post(
      `/api/projects/${projectId}/knowledge/chapters/import/confirm`,
      { content, chapterNos: options?.chapterNos }
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

export interface PreviewRetrievalItem {
  id: string;
  pool: 'persona_card' | 'other_docs' | 'recent_chapters' | 'memory_chapters';
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

export interface PersonaItem {
  id: string;
  name: string;
  profile: string;
  state: string;
  status: 'draft' | 'published';
  relationEventIds: string[];
  appearedChapterNos: number[];
  lastAppearedChapterNo: number | null;
  createdAt: string;
  updatedAt: string;
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
  narrativeSummary?: string;
  parseSource?: 'workbench' | 'chapter';
  parsedAt?: string;
  lastError?: string;
}

export interface StructuredInfoParseResult {
  chapter: ChapterItem;
  structuredInfo?: ChapterStructuredInfo;
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
}

export interface ChapterOptimizePlanCallbacks {
  onStart?: (payload: {
    traceId: string;
    chapterNo: number;
    planId: string;
    basis: ChapterOptimizationBasis;
  }) => void;
  onContent?: (text: string) => void;
  onEnd?: (result: ChapterOptimizationPlanResult) => void;
  onError?: (message: string) => void;
}

export interface ChapterOptimizeDraftCallbacks {
  onStart?: (traceId: string, chapterNo: number) => void;
  onContent?: (text: string) => void;
  onEnd?: (traceId: string) => void;
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
  onEnd?: (payload: { traceId: string; appliedIssueCount: number; autoCorrected: boolean }) => void;
  onError?: (message: string) => void;
}

export interface KnowledgeItem {
  outlineSummary: string;
  chapters: ChapterItem[];
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

export interface ChapterRelationEventGenerateResult {
  chapterNo: number;
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
