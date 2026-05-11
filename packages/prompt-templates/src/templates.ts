// Prompt 模板定义

export type PromptTemplateCategory = 'system' | 'project' | 'task' | 'persona';
export type PromptTemplateStatus = 'draft' | 'published' | 'archived';

export interface PromptTemplate {
  id: string;
  name: string;
  version: string;
  content: string;
  category: PromptTemplateCategory;
  status?: PromptTemplateStatus;
  systemPromptText?: string;
  constraints?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const defaultSystemTemplate: PromptTemplate = {
  id: 'system-default',
  name: '系统默认模板',
  version: '1.0.0',
  category: 'system',
  status: 'published',
  systemPromptText:
    '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。',
  content: '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。',
};

export const defaultPersonaTemplate: PromptTemplate = {
  id: 'persona-default',
  name: '人物模板-基础版',
  version: '1.0.0',
  category: 'persona',
  status: 'draft',
  systemPromptText: '请始终遵循人物设定与叙事语气',
  constraints: ['禁止脱离已知世界观', '禁止擅自篡改关键人物动机'],
  content: '角色身份：\n角色语气：\n角色禁忌：\n角色关系：',
};
