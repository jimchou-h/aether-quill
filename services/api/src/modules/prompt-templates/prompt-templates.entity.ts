export type TemplateCategory = 'system' | 'chapter' | 'persona' | 'custom';

export interface TemplateRecord {
  id: string;
  projectId: string;
  name: string;
  category: TemplateCategory;
  content: string;
  version: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateVersion {
  version: number;
  content: string;
  createdAt: Date;
  isPublished: boolean;
}

export interface PublishResult {
  configId: string;
  version: number;
  publishedAt: string;
}
