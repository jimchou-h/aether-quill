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
  // Compatibility methods
  async getProjects() {
    const result = await this.projects.list();
    return result.data || [];
  },

  async createProject(payload: { name: string; description: string }) {
    const result = await this.projects.create(payload);
    return (
      result.data || {
        id: '',
        name: payload.name,
        description: payload.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  },

  async getWorkspace(projectId: string) {
    const projectResult = await this.projects.get(projectId);
    const project = projectResult.data || {
      id: projectId,
      name: '',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const personas: PersonaItem[] = [];
    return {
      project,
      settings: {
        systemPromptText: '',
        activePersonaId: null,
        updatedAt: new Date().toISOString(),
      },
      personas,
      knowledge: {
        outlineSummary: '',
        chapters: [],
        indexVersion: 0,
        lastIndexedAt: null,
      },
      latestIndexJob: null as any,
    };
  },

  async getProjectExport(projectId: string) {
    const projectResult = await this.projects.get(projectId);
    return {
      project: projectResult.data,
      exportedAt: new Date().toISOString(),
      settings: {
        systemPromptText: '',
        activePersonaId: null as any,
        personas: [],
      },
      summary: {
        outlineSummary: '',
        chapterCount: 0,
        chapters: [],
      },
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSettings(_projectId: string) {
    return {
      systemPromptText: '',
      activePersonaId: null as any,
      updatedAt: new Date().toISOString(),
    };
  },

  async updateSettings(
    projectId: string,
    payload: { systemPromptText?: string; activePersonaId?: string | null }
  ) {
    if (payload.systemPromptText !== undefined) {
      await this.promptConfig.update(projectId, { systemPromptText: payload.systemPromptText });
    }
    return {
      systemPromptText: payload.systemPromptText || '',
      activePersonaId: payload.activePersonaId || null,
      updatedAt: new Date().toISOString(),
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPersonas(_projectId: string) {
    return [];
  },

  async createPersona(
    projectId: string,
    payload: { name: string; profile: string; tone?: string; constraints?: string[] }
  ) {
    return {
      id: 'temp-id',
      name: payload.name,
      profile: payload.profile,
      tone: payload.tone || '',
      constraints: payload.constraints || [],
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  async publishPersona(projectId: string, personaId: string) {
    return {
      id: personaId,
      name: '',
      profile: '',
      tone: '',
      constraints: [],
      status: 'published' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getKnowledge(_projectId: string) {
    return {
      outlineSummary: '',
      chapters: [],
      indexVersion: 0,
      lastIndexedAt: null,
    };
  },

  async updateOutline(projectId: string, payload: { outlineSummary: string }) {
    return {
      outlineSummary: payload.outlineSummary,
      chapters: [],
      indexVersion: 1,
      lastIndexedAt: new Date().toISOString(),
    };
  },

  async upsertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string }
  ) {
    return {
      chapterNo: payload.chapterNo,
      title: payload.title,
      content: payload.content,
      summary: '',
      updatedAt: new Date().toISOString(),
    };
  },

  async createReindexJob(projectId: string, payload: { mode?: 'full' | 'incremental' } = {}) {
    return {
      id: 'temp-job-id',
      projectId,
      mode: payload.mode || 'full',
      status: 'processing' as const,
      totalChapters: 0,
      processedChapters: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    };
  },

  async getReindexJob(projectId: string, jobId: string) {
    return {
      id: jobId,
      projectId,
      mode: 'full' as const,
      status: 'completed' as const,
      totalChapters: 0,
      processedChapters: 0,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMessage: null,
    };
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
    return {
      draftText: '',
      reasoningBrief: '',
      citations: [],
      consistencyNotes: [],
      autoUpdates: {
        chapterUpdated: false,
        outlineUpdated: false,
        personaUpdated: false,
        updateLine: '',
      },
      context: {
        projectId,
        chapterNo: payload.chapterNo,
        usedPersonaId: null,
        outlineUsed: false,
        recentChapterCount: 0,
        targetWords: payload.targetWords,
      },
    };
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
    const token = localStorage.getItem('token');
    const baseURL = http.defaults.baseURL || 'http://localhost:3000';

    const response = await fetch(`${baseURL}/api/generate/draft`, {
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

export interface ChapterItem {
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
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
