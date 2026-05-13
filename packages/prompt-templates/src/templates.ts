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

/**
 * 章节优化-方案模板（AQ-112）
 * 用于「输入要求 → 生成方案」步骤；user prompt 必须同时携带原章节正文与用户优化要求。
 */
export const chapterOptimizePlanTemplate: PromptTemplate = {
  id: 'chapter.optimize.plan',
  name: '章节优化-方案',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说编辑，正在协助用户对一段已存在的章节正文进行定向优化。',
    '本步骤只需要输出「优化方案」，不要直接输出新的正文。',
    '方案应当结构化、按段落或要点列出，覆盖：',
    '1) 用户要求与章节现状的差距诊断；',
    '2) 计划改写的段落 / 情节 / 对白 / 人物动机；',
    '3) 计划保留的关键事件与人物状态；',
    '4) 风险与一致性提示（如与大纲、人物状态、关系事件的冲突点）。',
    '请始终参考下文 <chapter-original> 标签中的原章节正文，不得凭空想象。',
  ].join('\n'),
  content: '章节优化-方案 system prompt（v1.0.0）',
};

/**
 * 章节优化-正文模板（AQ-112）
 * 用于「确认方案 → 生成新正文」步骤；user prompt 必须同时携带原章节正文与已确认的优化方案。
 */
export const chapterOptimizeDraftTemplate: PromptTemplate = {
  id: 'chapter.optimize.draft',
  name: '章节优化-正文',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手，正在按照已确认的优化方案重写一段已有章节正文。',
    '本步骤需要直接输出「优化后的章节正文」，不要输出任何方案、说明、Markdown 标题或代码块包裹。',
    '硬约束：',
    '1) 必须以下文 <chapter-original> 中的原章节正文为蓝本进行改写，禁止凭摘要扩写；',
    '2) 必须严格遵循 <optimization-plan> 中已确认的优化方案；',
    '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
    '4) 输出语言、人称、时态、人物名称必须与原文保持一致，除非方案明确要求修改；',
    '5) 输出风格必须与项目 systemPrompt 与人物设定保持一致。',
  ].join('\n'),
  content: '章节优化-正文 system prompt（v1.0.0）',
};

/**
 * 模板键到模板对象的映射（AQ-112）
 * orchestrator 在 /api/generate 收到 templateKey 时按此查找。
 */
export const templateRegistry: Record<string, PromptTemplate> = {
  [chapterOptimizePlanTemplate.id]: chapterOptimizePlanTemplate,
  [chapterOptimizeDraftTemplate.id]: chapterOptimizeDraftTemplate,
};

export function findTemplateByKey(key: string | undefined | null): PromptTemplate | undefined {
  if (!key) {
    return undefined;
  }
  return templateRegistry[key];
}
