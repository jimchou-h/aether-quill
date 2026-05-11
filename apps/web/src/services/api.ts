import axios from 'axios';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
});

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
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

export const apiClient = {
  async getProjects() {
    const { data } = await http.get<ProjectItem[]>('/api/projects');
    return data;
  },

  async createProject(payload: { name: string; description: string }) {
    const { data } = await http.post<ProjectItem>('/api/projects', payload);
    return data;
  },

  async getWorkspace(projectId: string) {
    const { data } = await http.get<{
      project: ProjectItem;
      settings: ProjectSettings;
      personas: PersonaItem[];
      knowledge: KnowledgeItem;
      latestIndexJob: IndexJob | null;
    }>(`/api/projects/${projectId}/workspace`);
    return data;
  },

  async getProjectExport(projectId: string) {
    const { data } = await http.get<ProjectExportBundle>(`/api/projects/${projectId}/export`);
    return data;
  },

  async getSettings(projectId: string) {
    const { data } = await http.get<ProjectSettings>(`/api/projects/${projectId}/settings`);
    return data;
  },

  async updateSettings(
    projectId: string,
    payload: { systemPromptText?: string; activePersonaId?: string | null }
  ) {
    const { data } = await http.put<ProjectSettings>(
      `/api/projects/${projectId}/settings`,
      payload
    );
    return data;
  },

  async getPersonas(projectId: string) {
    const { data } = await http.get<PersonaItem[]>(`/api/projects/${projectId}/personas`);
    return data;
  },

  async createPersona(
    projectId: string,
    payload: { name: string; profile: string; tone?: string; constraints?: string[] }
  ) {
    const { data } = await http.post<PersonaItem>(`/api/projects/${projectId}/personas`, payload);
    return data;
  },

  async publishPersona(projectId: string, personaId: string) {
    const { data } = await http.post<PersonaItem>(
      `/api/projects/${projectId}/personas/${personaId}/publish`
    );
    return data;
  },

  async getKnowledge(projectId: string) {
    const { data } = await http.get<KnowledgeItem>(`/api/projects/${projectId}/knowledge`);
    return data;
  },

  async updateOutline(projectId: string, payload: { outlineSummary: string }) {
    const { data } = await http.put<KnowledgeItem>(
      `/api/projects/${projectId}/knowledge/outline`,
      payload
    );
    return data;
  },

  async upsertChapter(
    projectId: string,
    payload: { chapterNo: number; title: string; content: string }
  ) {
    const { data } = await http.post<ChapterItem>(
      `/api/projects/${projectId}/knowledge/chapters`,
      payload
    );
    return data;
  },

  async createReindexJob(projectId: string, payload: { mode?: 'full' | 'incremental' } = {}) {
    const { data } = await http.post<IndexJob>(
      `/api/projects/${projectId}/knowledge/reindex`,
      payload
    );
    return data;
  },

  async getReindexJob(projectId: string, jobId: string) {
    const { data } = await http.get<IndexJob>(
      `/api/projects/${projectId}/knowledge/reindex/${jobId}`
    );
    return data;
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
    const { data } = await http.post<WriteResult>(`/api/projects/${projectId}/write`, payload);
    return data;
  },
};
