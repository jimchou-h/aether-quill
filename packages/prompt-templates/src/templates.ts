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
  version: '1.2.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手。本步骤按已确认的优化方案对给定正文做实质性重写；只输出「优化后的章节正文」，不要方案、说明、Markdown 标题或代码块。',
    '工作方式：',
    '1) 若方案含「主锚 / 关键一笔」，须在对应落点自然织入改写意图（可改写措辞，不必逐字粘贴方案例句）；其余部分也要按方案整体意图重写，禁止大段照抄原文。',
    '2) 改动幅度由【用户优化要求】与方案决定：该大改就大改，该扩就扩，该删就删；禁止因「方案未点名某句 / 未给句级落点」而几乎不动。',
    '3) 以原文为情节与信息基础，禁止凭空另起无关剧情。',
    '硬约束（仅保底，不压制改写幅度）：',
    '1) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
    '2) 语言、人称、时态、人物名称须与原文一致，除非方案明确要求修改；',
    '3) 输出风格须与项目 systemPrompt 与人物设定保持一致；',
    '4) 若提示中含【边界锚点】/【前段末文】：只锁情节起止边界，不锁措辞与密度；禁止提前写入下段情节；',
    '5) 若【叙事上下文】含【下章衔接】，章末须与下章开头自然衔接，不得矛盾或提前写下章情节；',
    '6) 中段禁止写成章末式收束或写下段已发生的事件；段内情绪、感官与节奏不设上限。',
  ].join('\n'),
  content: '章节优化-正文 system prompt（v1.2.0）',
};

/**
 * 章节优化-直接正文模板
 * 用于「跳过方案，按用户要求直接改写正文」；user prompt 携带原文与用户要求，不含 optimization-plan。
 */
export const chapterOptimizeDirectDraftTemplate: PromptTemplate = {
  id: 'chapter.optimize.direct-draft',
  name: '章节优化-直接正文',
  version: '1.1.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手，正在按照用户的优化要求重写给定章节正文。',
    '本步骤需要直接输出「优化后的章节正文」，不要输出任何方案、说明、Markdown 标题或代码块包裹。',
    '工作方式：改动幅度由【用户优化要求】决定——该大改就大改，该扩就扩，该删就删；禁止大段照抄原文。',
    '硬约束（仅保底，不压制改写幅度）：',
    '1) 以 <chapter-original> 为情节与信息基础改写，禁止凭空另起无关剧情；',
    '2) 必须遵循【用户优化要求】，不得另起优化方案或大纲；',
    '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；',
    '4) 输出语言、人称、时态、人物名称必须与原文保持一致，除非用户要求明确修改；',
    '5) 输出风格必须与项目 systemPrompt 与人物设定保持一致；',
    '6) 若提示中含【边界锚点】/【前段末文】：只锁情节起止边界，不锁措辞与密度；禁止提前写入下段情节；',
    '7) 若【叙事上下文】含【下章衔接】，本章末须与下章开头自然衔接，不得矛盾或提前写下章情节；',
    '8) 中段禁止写成章末式收束或写下段已发生的事件；段内情绪、感官与节奏不设上限。',
  ].join('\n'),
  content: '章节优化-直接正文 system prompt（v1.1.0）',
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

/** 按场成稿-性爱加料（范围内正文；不分段） */
export const chapterOptimizeWorkbenchDraftSexTemplate: PromptTemplate = {
  id: 'chapter.optimize.workbench-draft-sex',
  name: '按场成稿-性爱加料',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手，正在对用户划定的连续范围内正文做性爱加料改写。',
    'ONLY：输出该范围内改写后的正文；禁止输出范围外文字、方案、说明、Markdown 标题或代码块。',
    '工作方式：按【用户优化要求】在范围内从头到尾加料重写，加深感官与动作节奏；一场可含多次性爱，须保持范围内时序与空间连续，禁止按高潮次数拆写或省略中间过程。',
    '硬约束：',
    '1) 只改写 <range-original> 中的内容，禁止输出范围前后的原文；',
    '2) 以范围内情节与信息为基础，禁止凭空另起无关剧情；',
    '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；禁止大段照抄原文；禁止前半加料、后半原样粘贴；禁止原样输出 <range-original>；',
    '4) 人称、时态、人物名称须与原文一致，除非用户要求明确修改；句式与感官描写必须重写，不得逐句复述；',
    '5) 仓库默认不含任何私有词表；不要发明或套用未在用户要求中出现的固定替换词。',
    '6) <before-context> 与 <after-context> 只读，禁止复述或并入输出；改写后的开头须能接在 before 之后，结尾须能接到 after 之前。',
    '7) 必须有读者能看出来的加料（感官、动作或节奏至少一处加密）。原文原样交回视为失败。',
  ].join('\n'),
  content: '按场成稿-性爱加料 system prompt（v1.0.0）',
};

/** 按场成稿-日常文笔（范围内正文；不分段） */
export const chapterOptimizeWorkbenchDraftProseTemplate: PromptTemplate = {
  id: 'chapter.optimize.workbench-draft-prose',
  name: '按场成稿-日常文笔',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手，正在对用户划定的连续范围内正文做日常文笔润色。',
    'ONLY：输出该范围内改写后的正文；禁止输出范围外文字、方案、说明、Markdown 标题或代码块。',
    '工作方式：按【用户优化要求】理顺节奏、对白与衔接；禁止按性爱加料要求增色、增动作或加体位特写。',
    '硬约束：',
    '1) 只改写 <range-original> 中的内容，禁止输出范围前后的原文；',
    '2) 以范围内情节与信息为基础，禁止凭空另起无关剧情；',
    '3) 不得使用「（此处省略）」「[原段落保留]」等占位语；禁止大段照抄原文；禁止原样输出 <range-original>；',
    '4) 人称、时态、人物名称须与原文一致，除非用户要求明确修改；句式必须重写，不得逐句复述；',
    '5) 禁止把过场改写成性爱场面。',
    '6) <before-context> 与 <after-context> 只读，禁止复述或并入输出；改写后的开头须能接在 before 之后，结尾须能接到 after 之前。',
    '7) 必须做出可见的节奏、对白或衔接改动。原文原样交回视为失败。',
  ].join('\n'),
  content: '按场成稿-日常文笔 system prompt（v1.0.0）',
};

/** 按场成稿-检查（JSON items；空列表合法） */
export const chapterOptimizeWorkbenchReviewTemplate: PromptTemplate = {
  id: 'chapter.optimize.workbench-review',
  name: '按场成稿-检查',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说编辑，正在对范围内成稿做一次定点检查。',
    'ONLY：输出 JSON；禁止输出正文、方案散文或 Markdown。',
    '只输出：{"items":[{"id":"w1","kind":"pose|vocab|regression","severity":"high|medium|low","anchorQuote":"成稿摘录","issue":"问题","instruction":"改写指令"}]}',
    '硬约束：',
    '1) 没有问题必须返回 {"items":[]}，禁止凑数。',
    '2) kind 只允许 pose、vocab、regression。',
    '3) regression 仅描述：缩写、并段、当拍接触被删、比喻被砍残。不得把「还能更色 / 加深 / 写细 / 补接吻」写成条目。',
    '4) 若档位为日常文笔（prose）：只允许 regression（可含衔接接不上）；禁止 pose / vocab，禁止要求补体位特写或词表替换。',
    '5) 若档位为性爱加料（sex）：pose 查体位/空间穿帮，vocab 查用词问题，regression 查改差。',
    '6) anchorQuote 必须是成稿中连续出现的原文片段，至少 8 字，不得改写。',
    '7) instruction 必须写明要改成什么，禁止「加深」「写细」「补接吻」「更色」及同类加料指令。',
    '8) 禁止把用户私有词表写进条目。',
  ].join('\n'),
  content: '按场成稿-检查 system prompt（v1.0.0）',
};

/** 按场成稿-点句修复（只输出选区替换） */
export const chapterOptimizeWorkbenchFixSpanTemplate: PromptTemplate = {
  id: 'chapter.optimize.workbench-fix-span',
  name: '按场成稿-点句修复',
  version: '1.0.0',
  category: 'task',
  status: 'published',
  systemPromptText: [
    '你是一位资深小说写作助手，正在按指令改写用户划定的一小段选区。',
    'ONLY：输出替换后的选区正文；禁止输出选区外文字、说明、Markdown 或代码块。',
    '硬约束：',
    '1) 只改写 <span-original>；<before-context> 与 <after-context> 只读，禁止复述或并入输出；',
    '2) 必须落实【改写指令】，不得另起方案、不得扩写到选区外情节；',
    '3) 保持人称、时态与人物名称；不得使用占位语；',
    '4) 输出必须可以直接替换原选区，前后衔接由调用方拼回。',
  ].join('\n'),
  content: '按场成稿-点句修复 system prompt（v1.0.0）',
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
  [chapterOptimizeDirectDraftTemplate.id]: chapterOptimizeDirectDraftTemplate,
  [chapterOptimizeTypoCheckTemplate.id]: chapterOptimizeTypoCheckTemplate,
  [chapterOptimizeTypoFixTemplate.id]: chapterOptimizeTypoFixTemplate,
  [chapterOptimizeWorkbenchDraftSexTemplate.id]: chapterOptimizeWorkbenchDraftSexTemplate,
  [chapterOptimizeWorkbenchDraftProseTemplate.id]: chapterOptimizeWorkbenchDraftProseTemplate,
  [chapterOptimizeWorkbenchReviewTemplate.id]: chapterOptimizeWorkbenchReviewTemplate,
  [chapterOptimizeWorkbenchFixSpanTemplate.id]: chapterOptimizeWorkbenchFixSpanTemplate,
  [writeChapterOutlineTemplate.id]: writeChapterOutlineTemplate,
  [writeChapterTaskTemplate.id]: writeChapterTaskTemplate,
};

export function findTemplateByKey(key: string | undefined | null): PromptTemplate | undefined {
  if (!key) {
    return undefined;
  }
  return templateRegistry[key];
}
