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

export interface ConsistencyNote {
  level: 'info' | 'warning' | 'block';
  message: string;
}

export interface SseEndEvent {
  event: 'end';
  traceId: string;
  citations: CitationItem[];
  consistencyNotes: ConsistencyNote[];
}

export interface SseErrorEvent {
  event: 'error';
  data: string;
  traceId: string;
}

export type SseEvent = SseStartEvent | SseContentEvent | SseEndEvent | SseErrorEvent;

export interface SseCallbacks {
  onStart?: (traceId: string, chapterNo: number) => void;
  onContent?: (text: string) => void;
  onEnd?: (traceId: string, citations: CitationItem[], consistencyNotes: ConsistencyNote[]) => void;
  onError?: (error: string) => void;
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

// Request interceptor for auth
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for error handling
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
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

  async updateSettings(
    projectId: string,
    payload: { systemPromptText?: string; activePersonaId?: string | null }
  ) {
    const response = await http.put(`/api/projects/${projectId}/settings`, payload);
    return this.unwrapPayload<ProjectSettings>(response.data);
  },

  async getPersonas(projectId: string) {
    const response = await http.get(`/api/projects/${projectId}/personas`);
    return this.unwrapPayload<PersonaItem[]>(response.data);
  },

  async createPersona(
    projectId: string,
    payload: { name: string; profile: string; tone?: string; constraints?: string[] }
  ) {
    const response = await http.post(`/api/projects/${projectId}/personas`, payload);
    return this.unwrapPayload<PersonaItem>(response.data);
  },

  async publishPersona(projectId: string, personaId: string) {
    const response = await http.post(`/api/projects/${projectId}/personas/${personaId}/publish`);
    return this.unwrapPayload<PersonaItem>(response.data);
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
    return this.unwrapPayload<ChapterItem>(response.data);
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

  async writeChapter(
    projectId: string,
    payload: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude: string[];
      avoid: string[];
      targetWords: number;
    }
  ) {
    const response = await http.post(`/api/projects/${projectId}/write`, payload);
    return this.unwrapPayload<WriteResult>(response.data);
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

  async syncProjectContext(projectId: string) {
    const workspace = await this.getWorkspace(projectId);
    const activePersona =
      workspace.personas.find((persona) => persona.id === workspace.settings.activePersonaId) ||
      workspace.personas.find((persona) => persona.status === 'published') ||
      null;

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
          ? `${activePersona.name}\n${activePersona.profile}\n语气：${activePersona.tone}`
          : '未配置人物设定',
        outlineSummary: workspace.knowledge.outlineSummary,
        chapters: workspace.knowledge.chapters.map((chapter) => ({
          chapterNo: chapter.chapterNo,
          title: chapter.title,
          summary: chapter.summary || chapter.content.slice(0, 160),
        })),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(errorBody || '同步项目上下文失败');
    }
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
      targetWords: number;
    },
    citations: CitationItem[],
    callbacks: SseCallbacks
  ): Promise<void> {
    await this.syncProjectContext(projectId);

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
              case 'content':
                callbacks.onContent?.(data.data.replace(/\\n/g, '\n'));
                break;
              case 'end':
                callbacks.onEnd?.(data.traceId, data.citations, data.consistencyNotes);
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

  // Document helper methods
  async getDocument(id: string) {
    const response = await http.get(`/api/documents/${id}`);
    return response.data;
  },

  async updateDocument(id: string, payload: { title?: string; content?: string }) {
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

export interface DocumentItem {
  id: string;
  projectId: string;
  title: string;
  content: string;
  indexStatus: 'pending' | 'indexing' | 'completed' | 'failed';
  version: number;
  createdAt: string;
  updatedAt: string;
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

export interface ProjectSettings {
  systemPromptText: string;
  activePersonaId: string | null;
  updatedAt: string;
}

export interface PersonaItem {
  id: string;
  name: string;
  profile: string;
  tone: string;
  constraints: string[];
  status: 'draft' | 'published';
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

export interface WriteResult {
  draftText: string;
  reasoningBrief: string;
  citations: Array<{ sourceType: string; sourceId: string; snippet: string }>;
  consistencyNotes: Array<{ level: 'info' | 'warning'; message: string }>;
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
    targetWords: number;
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
