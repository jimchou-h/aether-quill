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

/** 章节优化-错字检查（AQ-250 登记；运行时默认见 API `chapter-optimize.util`） */
export const chapterOptimizeTypoCheckTemplate: PromptTemplate = {
  id: 'chapter.optimize.typo-check',
  name: '章节优化-错字检查',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText:
    '你是一位资深中文小说校对编辑。本步骤只输出 JSON issues 数组，不要 Markdown。',
  content: '章节优化-错字检查 system prompt（v1.0.0）',
};

/** 章节优化-错字修正（AQ-250 登记） */
export const chapterOptimizeTypoFixTemplate: PromptTemplate = {
  id: 'chapter.optimize.typo-fix',
  name: '章节优化-错字修正',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText:
    '你是一位资深中文小说校对编辑。本步骤直接输出修正后的完整正文纯文本。',
  content: '章节优化-错字修正 system prompt（v1.0.0）',
};

/**
 * 通用章节续写（AQ-122）
 *
 * 运行时由 `services/rag-orchestrator` 的 `GenerationService.buildLlmMessages` 拼装为：
 *   system ← 全局默认 + 项目 systemPromptText + 任务 taskSystemPrompt
 *   user   ←【叙事上下文】【检索证据】【用户需求】
 *
 * 章节优化 task 默认以 `services/api/.../chapter-optimize.util.ts` 为扩展真源；
 * 本包登记供治理审计，文本较短时以 util 常量为准。
 */
/**
 * 写作工作台-章节大纲（AQ-217~AQ-219）
 * 用于「写作要求 → 生成/确认大纲」步骤；不输出正文。
 */
export const writeChapterOutlineTemplate: PromptTemplate = {
  id: 'write.chapter.outline',
  name: '写作工作台-章节大纲',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说策划编辑，正在根据作者的写作要求为本章拟定「章节大纲」。',
    '本步骤只需要输出结构化章节大纲，不要直接输出小说正文。',
    '请始终参考 <writing-task> 中的约束，并与【叙事上下文】保持一致。',
  ].join('\n'),
  content: '写作工作台-章节大纲 system prompt（v1.0.0）',
};

export const writeChapterTaskTemplate: PromptTemplate = {
  id: 'write.chapter',
  name: '通用章节续写（叙事上下文 + 检索证据）',
  version: '1.2.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位专业小说写作助手，正在根据作者已确认的章节大纲撰写本章正文。',
    '必须严格遵循 <chapter-outline> 中的结构与节拍，并区分「叙事上下文」与「检索证据」。',
    '证据块仅作参考，不得当作已发表正文复述。',
  ].join('\n'),
  content:
    '占位说明：{{narrativeContext}}、{{retrievedEvidence}} 由 Orchestrator 注入；正文阶段须携带 <chapter-outline>。',
};

/**
 * 模板键到模板对象的映射（AQ-112 + AQ-122）
 * orchestrator 在 /api/generate 收到 templateKey 时按此查找。
 */
export const templateRegistry: Record<string, PromptTemplate> = {
  [chapterOptimizePlanTemplate.id]: chapterOptimizePlanTemplate,
  [chapterOptimizeDraftTemplate.id]: chapterOptimizeDraftTemplate,
  [chapterOptimizeTypoCheckTemplate.id]: chapterOptimizeTypoCheckTemplate,
  [chapterOptimizeTypoFixTemplate.id]: chapterOptimizeTypoFixTemplate,
  [writeChapterOutlineTemplate.id]: writeChapterOutlineTemplate,
  [writeChapterTaskTemplate.id]: writeChapterTaskTemplate,
};

export function findTemplateByKey(key: string | undefined | null): PromptTemplate | undefined {
  if (!key) {
    return undefined;
  }
  return templateRegistry[key];
}
