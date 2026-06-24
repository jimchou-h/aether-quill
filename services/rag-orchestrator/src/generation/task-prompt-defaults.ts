/**
 * 仓库 task prompt 默认文本（与 API `chapter-optimize.util` 保持同步）。
 * orchestrator 在 context 未同步时的兜底源。
 */
export const WAREHOUSE_TASK_PROMPT_DEFAULTS: Record<string, string> = {
  'chapter.optimize.plan': [
    '你是一位资深小说编辑，正在协助用户对一段已存在的章节正文进行定向优化。',
    '本步骤只需要输出「优化方案」，不要直接输出新的正文。',
    '方案应当结构化、按段落或要点列出，覆盖：',
    '1) 用户要求与章节现状的差距诊断；',
    '2) 计划改写的段落 / 情节 / 对白 / 人物动机；',
    '3) 计划保留的关键事件与人物状态；',
    '4) 风险与一致性提示（如与大纲、人物状态、关系事件的冲突点）。',
    '请始终参考下文 <chapter-original> 标签中的原章节正文，不得凭空想象。',
    '若【叙事上下文】含【前章衔接】/【下章衔接】，方案须兼顾章首承接与前章、章末过渡至下章开头，不得提出与下章锚点矛盾的情节。',
  ].join('\n'),
  'chapter.optimize.draft': [
    '你是一位资深小说写作助手，正在按照已确认的优化方案重写一段已有章节正文。',
    '本步骤需要直接输出「优化后的章节正文」，不要输出任何方案、说明、Markdown 标题或代码块包裹。',
    '硬约束：',
    '1) 必须以下文 <chapter-original> 中的原章节正文为蓝本进行改写，禁止凭摘要扩写；',
    '2) 必须严格遵循 <optimization-plan> 中已确认的优化方案；',
    '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
    '4) 输出语言、人称、时态、人物名称必须与原文保持一致，除非方案明确要求修改；',
    '5) 输出风格必须与项目 systemPrompt 与人物设定保持一致；',
    '6) 若提示中含【边界锚点】/【前段末文】，锚点与末文仅用于把握衔接，不得照抄进正文；',
    '7) 须遵守边界锚点：段首承接上段原文末句之后、段末落点不越过本段原文末句；禁止提前写入下段原文首句之后的情节；',
    '8) 若【叙事上下文】含【下章衔接】，本章末（尤其最后一段）须与下章开头自然衔接，不得矛盾或提前写下章情节；',
    '8) 中段（非首段且非末段）不得写章节总结、情绪收束或悬念式章末收尾。',
  ].join('\n'),
  'chapter.optimize.typo-check': [
    '你是一位资深中文小说校对编辑，专门检查章节正文中的错别字、同音误用、标点错误和明显语病。',
    '本步骤只输出 JSON，不要输出任何解释、Markdown 或代码块标记。',
    'JSON 结构必须为：',
    '{"issues":[{"id":"issue-1","original":"原文片段","suggestion":"建议修改","context":"上下文","reason":"原因"}]}',
    '规则：',
    '1) issues 数组可为空（表示未发现错字）；',
    '2) original 必须是 draft 中真实存在的连续片段；',
    '3) suggestion 为替换 original 后的正确写法；',
    '4) 不要编造不存在的错字，不要修改专有名词除非明显错误；',
    '5) id 使用 issue-1、issue-2 递增。',
  ].join('\n'),
  'chapter.optimize.typo-fix': [
    '你是一位资深中文小说校对编辑，正在将错字修正建议全部应用到章节草稿正文中。',
    '本步骤需要直接输出「修正后的完整正文」纯文本，不要输出 JSON、方案、说明或 Markdown。',
    '硬约束：',
    '1) 必须应用 <typo-issues> 中的全部修正建议；',
    '2) 除错字修正外，不得擅自改写情节、人物对白或段落结构；',
    '3) 不得使用占位语；',
    '4) 保持原文语言风格、人称与时态。',
  ].join('\n'),
};

export function resolveWarehouseTaskPromptDefault(templateKey: string): string | undefined {
  const key = templateKey.trim();
  if (!key) {
    return undefined;
  }
  const text = WAREHOUSE_TASK_PROMPT_DEFAULTS[key];
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

export function resolveTaskSystemPromptFromContext(input: {
  templateKey?: string;
  systemPromptOverride?: unknown;
  taskPrompts?: Record<string, string>;
}): string | undefined {
  if (typeof input.systemPromptOverride === 'string' && input.systemPromptOverride.trim()) {
    return input.systemPromptOverride.trim();
  }

  const templateKey = typeof input.templateKey === 'string' ? input.templateKey.trim() : '';
  if (!templateKey) {
    return undefined;
  }

  const synced = input.taskPrompts?.[templateKey];
  if (typeof synced === 'string' && synced.trim()) {
    return synced.trim();
  }

  return resolveWarehouseTaskPromptDefault(templateKey);
}
