export interface ProjectTaskPromptRecord {
  projectId: string;
  templateKey: string;
  draftText: string;
  publishedText: string;
  version: number;
  updatedAt: string;
}

export interface TaskPromptVersionSnapshot {
  version: number;
  draftText: string;
  publishedText: string;
  createdAt: string;
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

export interface TaskPromptDetail extends TaskPromptListItem {}

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
