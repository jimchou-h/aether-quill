// @aether-quill/shared-types
// 共享类型定义

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PersonaStatus = 'draft' | 'published';
export type IndexMode = 'full' | 'incremental';
export type IndexJobStatus = 'processing' | 'completed' | 'failed';

export interface PersonaProfile {
  id: string;
  projectId: string;
  name: string;
  profile: string;
  tone: string;
  constraints: string[];
  status: PersonaStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  projectId: string;
  systemPromptText: string;
  activePersonaId: string | null;
  updatedAt: Date;
}

export interface ChapterSummary {
  projectId: string;
  chapterNo: number;
  title: string;
  content: string;
  summary: string;
  updatedAt: Date;
}

export interface ProjectKnowledge {
  projectId: string;
  outlineSummary: string;
  chapters: ChapterSummary[];
  indexVersion: number;
  lastIndexedAt: Date | null;
}

export interface IndexJob {
  id: string;
  projectId: string;
  mode: IndexMode;
  status: IndexJobStatus;
  totalChapters: number;
  processedChapters: number;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface GenerateTask {
  projectId: string;
  chapterNo: number;
  goal: string;
  pov: string;
  mustInclude: string[];
  avoid: string[];
  targetWords: number;
}

export interface Citation {
  sourceType: 'outline' | 'chapter-summary';
  sourceId: string;
  snippet: string;
}

export interface ConsistencyNote {
  level: 'info' | 'warning';
  message: string;
}
