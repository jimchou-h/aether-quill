// Prompt 模板定义

export interface PromptTemplate {
  id: string;
  name: string;
  version: string;
  content: string;
  category: 'system' | 'project' | 'task';
}

export const defaultSystemTemplate: PromptTemplate = {
  id: 'system-default',
  name: '系统默认模板',
  version: '1.0.0',
  category: 'system',
  content: '你是一位专业的小说写作助手。请帮助用户进行小说创作，保持逻辑连贯和设定一致性。'
};
