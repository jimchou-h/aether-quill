/**
 * 章节优化工具（AQ-113）
 *
 * 提供 plan / draft user prompt 拼装、章节版本乐观锁校验、instruction 校验等纯函数。
 *
 * 模板治理同步入口：`packages/prompt-templates/src/templates.ts`
 *  - chapterOptimizePlanTemplate / chapterOptimizeDraftTemplate（基础登记）
 *  - 本文件 `CHAPTER_OPTIMIZE_*_SYSTEM_PROMPT` 为**运行时仓库默认种子**（含衔接等扩展句）
 *  - `task-prompt-defaults.ts` 与 `rag-orchestrator/.../task-prompt-defaults.ts` 须与本文件保持一致
 * 任何一边变更，都必须同步另一边，避免运行时与治理副本漂移。
 */

export interface ChapterOptimizeChapterRef {
  chapterNo: number;
  title: string;
  content: string;
  updatedAt: Date;
}

export interface ChapterOptimizeUsedRelationEvent {
  id: string;
  protagonist: string;
  counterparty: string;
  summary: string;
  evidenceSnippet?: string;
  chapterNo: number | null;
}

export const CHAPTER_OPTIMIZE_PLAN_TEMPLATE_KEY = 'chapter.optimize.plan';
export const CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY = 'chapter.optimize.draft';
export const CHAPTER_OPTIMIZE_DIRECT_DRAFT_TEMPLATE_KEY = 'chapter.optimize.direct-draft';

export type ChapterOptimizeRewriteMode = 'from-plan' | 'direct';

export const CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在协助用户对一段已存在的章节正文进行定向优化。',
  '本步骤只需要输出「优化方案」，不要直接输出新的正文。',
  '方案应当结构化、按段落或要点列出，覆盖：',
  '1) 用户要求与章节现状的差距诊断；',
  '2) 计划改写的段落 / 情节 / 对白 / 人物动机；',
  '3) 计划保留的关键事件与人物状态；',
  '4) 风险与一致性提示（如与大纲、人物状态、关系事件的冲突点）。',
  '请始终参考下文 <chapter-original> 标签中的原章节正文，不得凭空想象。',
  '若【叙事上下文】含【前章衔接】/【下章衔接】，方案须兼顾章首承接与前章、章末过渡至下章开头，不得提出与下章锚点矛盾的情节。',
].join('\n');

export const CHAPTER_OPTIMIZE_DRAFT_SYSTEM_PROMPT = [
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
].join('\n');

export const CHAPTER_OPTIMIZE_DIRECT_DRAFT_SYSTEM_PROMPT = [
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
].join('\n');

/** 低于此字数优先单段生成，减少硬切分（可通过环境变量覆盖） */
export const OPTIMIZE_SINGLE_SEGMENT_CHAR_THRESHOLD = 2800;
/** 长章按固定字数切分，每段约 3000 字（项目 settings 可覆盖；0 表示不分段） */
export const OPTIMIZE_SEGMENT_CHAR_SIZE = 3000;
export const DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE = OPTIMIZE_SEGMENT_CHAR_SIZE;
export const MAX_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE = 20000;

export type ChapterOptimizeMode = 'single' | 'segmented';

export type ChapterOptimizeStage =
  | 'syncing_context'
  | 'retrieving'
  | 'waiting_llm'
  | 'segment_diagnosis'
  | 'plan_synthesis'
  | 'draft_segment'
  | 'merge_validation'
  | 'content_safety_scan'
  | 'content_safety_rewrite'
  | 'frozen_review';

export interface ChapterOptimizeLengthStrategy {
  mode: ChapterOptimizeMode;
  segmentCount: number;
  inputChapterChars: number;
  strategyLabel: string;
}

export interface OptimizeDraftExecution {
  optimizationMode: ChapterOptimizeMode;
  segmentTotal: number;
  strategyLabel: string;
  skipPlanDiagnosis: boolean;
}

export function resolveOptimizeDraftExecution(input: {
  rewriteMode: ChapterOptimizeRewriteMode;
  strategy: ChapterOptimizeLengthStrategy;
}): OptimizeDraftExecution {
  const skipPlanDiagnosis = input.rewriteMode === 'direct';
  if (input.strategy.mode === 'segmented') {
    return {
      optimizationMode: 'segmented',
      segmentTotal: input.strategy.segmentCount,
      strategyLabel:
        input.rewriteMode === 'direct'
          ? `按要求直接分段生成正文（${input.strategy.segmentCount} 段）`
          : `按方案分段生成正文（${input.strategy.segmentCount} 段）`,
      skipPlanDiagnosis,
    };
  }
  return {
    optimizationMode: 'single',
    segmentTotal: 1,
    strategyLabel:
      input.rewriteMode === 'direct' ? '按要求直接生成正文' : '整章生成正文',
    skipPlanDiagnosis,
  };
}

export function listOptimizeDraftSseStages(
  execution: Pick<OptimizeDraftExecution, 'optimizationMode'>
): ChapterOptimizeStage[] {
  const stages: ChapterOptimizeStage[] = ['syncing_context', 'retrieving'];
  if (execution.optimizationMode === 'segmented') {
    stages.push('draft_segment');
  }
  stages.push('merge_validation');
  return stages;
}

export interface ChapterOptimizeConfig {
  segmentationEnabled: boolean;
  singleSegmentThreshold: number;
  segmentCharSize: number;
}

function parsePositiveIntEnv(key: string, fallback: number): number {
  const raw = (process.env[key] ?? '').trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSegmentationEnabledEnv(): boolean {
  const raw = (process.env.CHAPTER_OPTIMIZE_SEGMENTATION_ENABLED ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

export function resolveChapterOptimizeConfig(): ChapterOptimizeConfig {
  return {
    segmentationEnabled: parseSegmentationEnabledEnv(),
    singleSegmentThreshold: parsePositiveIntEnv(
      'CHAPTER_OPTIMIZE_SINGLE_SEGMENT_CHAR_THRESHOLD',
      OPTIMIZE_SINGLE_SEGMENT_CHAR_THRESHOLD
    ),
    segmentCharSize: parsePositiveIntEnv(
      'CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE',
      OPTIMIZE_SEGMENT_CHAR_SIZE
    ),
  };
}

/** 项目 settings 覆盖环境变量中的分段字数；0 表示不按字数分段 */
export function clampChapterOptimizeSegmentCharSize(value: unknown): number {
  if (value === 0 || value === '0') {
    return 0;
  }
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE;
  }
  if (parsed === 0) {
    return 0;
  }
  return Math.min(MAX_CHAPTER_OPTIMIZE_SEGMENT_CHAR_SIZE, Math.trunc(parsed));
}

export function resolveChapterOptimizeConfigWithProjectOverride(
  projectSegmentCharSize?: number
): ChapterOptimizeConfig {
  const base = resolveChapterOptimizeConfig();
  if (projectSegmentCharSize === undefined) {
    return base;
  }
  return {
    ...base,
    segmentCharSize: clampChapterOptimizeSegmentCharSize(projectSegmentCharSize),
  };
}

export function resolveChapterOptimizeSegmentCount(
  contentLength: number,
  config: ChapterOptimizeConfig = resolveChapterOptimizeConfig()
): number {
  const inputChapterChars = Math.max(0, Math.trunc(contentLength));
  if (
    !config.segmentationEnabled ||
    config.segmentCharSize === 0 ||
    inputChapterChars <= config.singleSegmentThreshold
  ) {
    return 1;
  }
  return Math.max(1, Math.ceil(inputChapterChars / config.segmentCharSize));
}

export function resolveChapterOptimizeLengthStrategy(
  contentLength: number,
  config: ChapterOptimizeConfig = resolveChapterOptimizeConfig()
): ChapterOptimizeLengthStrategy {
  const inputChapterChars = Math.max(0, Math.trunc(contentLength));
  const segmentCount = resolveChapterOptimizeSegmentCount(inputChapterChars, config);

  if (segmentCount <= 1) {
    const disabledByZeroSize =
      config.segmentCharSize === 0 &&
      inputChapterChars > config.singleSegmentThreshold;
    return {
      mode: 'single',
      segmentCount: 1,
      inputChapterChars,
      strategyLabel: disabledByZeroSize ? '整章优化（未按字数分段）' : '整章优化',
    };
  }

  return {
    mode: 'segmented',
    segmentCount,
    inputChapterChars,
    strategyLabel: `${segmentCount} 段优化（约 ${config.segmentCharSize} 字/段）`,
  };
}
export const SEGMENT_TAIL_CONTEXT_CHARS = 400;
export const SEGMENT_LEAD_CONTEXT_CHARS = 200;
/**
 * 中段 maxTokens 相对原文字符的余量倍率。
 *
 * 这是防跑飞的安全阀，不是改动量约束：留足扩写空间，越界由边界锚点在 prompt 层把关。
 */
export const MIDDLE_SEGMENT_MAX_TOKEN_CHAR_RATIO = 2.2;
/** 短章也给够一轮写完的带宽 */
export const CHAPTER_OPTIMIZE_MIN_MAX_TOKENS = 4096;
/**
 * 整章 / 分段正文输出上限。DeepSeek V4 官方 max output 384K，这里只放宽到
 * 65536，避免长章方案改写被 16K 掐断，同时限制单次费用和超时。
 */
export const CHAPTER_OPTIMIZE_MAX_MAX_TOKENS = 65536;
/** 单段输出超过原文此倍率视为跑飞（写进了下段情节），才触发重试 */
export const SEGMENT_LENGTH_RETRY_RATIO = 2.5;
/** 分段诊断 / 生成失败时，每段最多额外重试次数 */
export const CHAPTER_OPTIMIZE_SEGMENT_MAX_RETRIES = 1;

export interface ChapterOptimizeSegmentRecovery {
  failedSegmentIndex?: number;
  segmentTotal?: number;
  segmentDiagnoses?: string[];
  retryable?: boolean;
}

export function normalizeInstruction(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export const MAX_OPTIMIZE_INSTRUCTION_CHARS = 20000;

export function assertInstruction(value: string): void {
  if (!value) {
    throw new Error('优化要求 instruction 不能为空');
  }
  if (value.length > MAX_OPTIMIZE_INSTRUCTION_CHARS) {
    throw new Error(`优化要求 instruction 长度不能超过 ${MAX_OPTIMIZE_INSTRUCTION_CHARS} 字符`);
  }
}

export function assertPlanText(value: string): void {
  if (!value || !value.trim()) {
    throw new Error('优化方案 planText 不能为空');
  }
}

export function normalizeRewriteMode(value: unknown): ChapterOptimizeRewriteMode {
  return value === 'direct' ? 'direct' : 'from-plan';
}

export function resolveOptimizeDraftTemplateKey(mode: ChapterOptimizeRewriteMode): string {
  return mode === 'direct'
    ? CHAPTER_OPTIMIZE_DIRECT_DRAFT_TEMPLATE_KEY
    : CHAPTER_OPTIMIZE_DRAFT_TEMPLATE_KEY;
}

export const DRAFT_REFINE_USER_CONSTRAINT =
  '本轮是按已确认优化方案对上一稿正文的收紧改写：<chapter-original> 为上一轮优化正文，不是入库原文。必须执行 <optimization-plan> 中尚未落实或落实不足的条目，不得另起优化方案或大纲。';

export const DRAFT_REVIEW_GAPS_CONSTRAINT =
  '本轮只补【冻结合同未落实缺口】里的实质缺口，禁止另开润色愿望、另起方案或重写无关段落。';

export const CHAPTER_OPTIMIZE_FROZEN_REVIEW_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对照「冻结合同」验收一稿刚写完的章节正文。',
  '冻结合同 = 用户优化要求 + 本轮已确认优化方案 + 项目写作风格（systemPrompt）。',
  '只判断：合同是否仍有实质未落实，或改写是否改坏了合同要求保留的情节 / 人物 / 衔接。',
  '禁止提出合同之外的新润色愿望，禁止输出新正文或新方案。',
  '若没有实质缺口，只输出一行：【验收结论】CLOSED',
  '若有实质缺口，第一行必须是【验收结论】GAPS，随后用【缺口说明】列出可执行缺口（点明落点与要补的意图）。',
].join('\n');

export function parseFrozenReviewResult(reviewText: string): {
  hasMaterialGaps: boolean;
  reviewText: string;
} {
  const text = reviewText.trim();
  const hasClosed = /【验收结论】\s*CLOSED/i.test(text);
  const hasGaps = /【验收结论】\s*GAPS/i.test(text);
  if (hasClosed && !hasGaps) {
    return { hasMaterialGaps: false, reviewText: text };
  }
  if (hasGaps) {
    return { hasMaterialGaps: true, reviewText: text };
  }
  if (/无实质缺口|没有实质缺口|可以收口/.test(text) && text.length < 200) {
    return { hasMaterialGaps: false, reviewText: text };
  }
  return { hasMaterialGaps: text.length >= 80, reviewText: text };
}

export function buildFrozenReviewUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  draftText: string;
}): string {
  return [
    `【验收目标】对照冻结合同验收第${input.chapter.chapterNo}章「${input.chapter.title}」的新正文。`,
    `【用户优化要求】\n${input.instruction.trim()}`,
    `<optimization-plan chapter-no="${input.chapter.chapterNo}">\n${input.planText.trim()}\n</optimization-plan>`,
    `<chapter-draft chapter-no="${input.chapter.chapterNo}">\n${input.draftText.trim()}\n</chapter-draft>`,
    '只输出验收结论。没有实质缺口则【验收结论】CLOSED；有则【验收结论】GAPS + 【缺口说明】。禁止新正文或新方案。',
  ].join('\n\n');
}

export function normalizeReviewGaps(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length > 8000) {
    throw new Error('验收缺口 reviewGaps 长度不能超过 8000 字符');
  }
  return trimmed;
}

export function resolveDraftSplitSource(chapterContent: string, sourceText?: string): string {
  const previous = sourceText?.trim();
  return previous || chapterContent;
}

export function normalizeDraftSourceText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length > 200000) {
    throw new Error('上一稿正文 sourceText 长度不能超过 200000 字符');
  }
  return trimmed;
}

export function assertOptimizeDraftRequest(input: {
  rewriteMode?: unknown;
  instruction?: unknown;
  planText?: unknown;
  sourceText?: unknown;
  reviewGaps?: unknown;
}): {
  rewriteMode: ChapterOptimizeRewriteMode;
  instruction: string;
  planText: string;
  sourceText: string;
  reviewGaps: string;
} {
  const rewriteMode = normalizeRewriteMode(input.rewriteMode);
  const instruction = normalizeInstruction(input.instruction);
  assertInstruction(instruction);
  const planText = typeof input.planText === 'string' ? input.planText.trim() : '';
  if (rewriteMode === 'from-plan') {
    assertPlanText(planText);
  }
  const sourceText = rewriteMode === 'direct' ? '' : normalizeDraftSourceText(input.sourceText);
  const reviewGaps = rewriteMode === 'direct' ? '' : normalizeReviewGaps(input.reviewGaps);
  return { rewriteMode, instruction, planText, sourceText, reviewGaps };
}

export function buildPlanRevisionInstruction(input: {
  instruction: string;
  currentPlanText: string;
  revisionFeedback: string;
}): string {
  const instruction = normalizeInstruction(input.instruction);
  const currentPlanText = input.currentPlanText.trim();
  const revisionFeedback = normalizeInstruction(input.revisionFeedback);
  assertInstruction(instruction);
  assertPlanText(currentPlanText);
  if (!revisionFeedback) {
    throw new Error('方案修改意见 revisionFeedback 不能为空');
  }
  if (revisionFeedback.length > 2000) {
    throw new Error('方案修改意见 revisionFeedback 长度不能超过 2000 字符');
  }
  if (currentPlanText.length > 20000) {
    throw new Error('当前优化方案 currentPlanText 长度不能超过 20000 字符');
  }

  return [
    `【原始优化要求】\n${instruction}`,
    `<current-optimization-plan>\n${currentPlanText}\n</current-optimization-plan>`,
    `【本轮方案修改意见】\n${revisionFeedback}`,
    '请基于当前优化方案和本轮意见输出一份完整的新版优化方案。未要求修改的内容应保留；只输出调整后的完整方案，不要解释修改过程。',
  ].join('\n\n');
}

export function assertDraftText(value: string): void {
  if (!value || !value.trim()) {
    throw new Error('优化正文 draftText 不能为空');
  }
}

export function buildPlanUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, appearingCharacters, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(`【优化目标】请对第${chapter.chapterNo}章「${chapter.title}」进行优化。`);
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${chapter.content}\n</chapter-original>`
  );

  sections.push('请基于以上信息输出「优化方案」，结构化呈现要点，禁止直接输出新的正文。');

  return sections.join('\n\n');
}

export const CHAPTER_OPTIMIZE_SEGMENT_DIAGNOSIS_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对长章节中的「局部片段」做优化前诊断。',
  '本步骤只输出该片段的诊断报告，不要输出新的正文，也不要输出整章方案。',
  '诊断须结构化，覆盖：',
  '1) 本段现状问题（节奏、描写、逻辑、语气等）；',
  '2) 必须保留的情节、对白、动作、人物状态；',
  '3) 可优化的要点；',
  '4) 与前后段的边界约束（段首承接、段末落点，不得越界）。',
].join('\n');

export function buildSegmentDiagnosisSystemPrompt(publishedPlanText?: string): string {
  const plan = publishedPlanText?.trim() || CHAPTER_OPTIMIZE_PLAN_SYSTEM_PROMPT;
  return [
    plan,
    '',
    CHAPTER_OPTIMIZE_SEGMENT_DIAGNOSIS_SYSTEM_PROMPT,
    '【本步限定】只扫描当前片段。仍按上方方案标准判断本段；禁止输出整章方案或新正文。',
  ].join('\n');
}

export const CHAPTER_OPTIMIZE_PLAN_SYNTHESIS_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在把多段局部诊断汇总为一份完整的整章优化方案。',
  '本步骤只输出「优化方案」，不要直接输出新的正文。',
  '方案必须包含：',
  '1) 全章总体目标；',
  '2) 分段优化要点（逐段列出，覆盖每一段）；',
  '3) 关键情节保留清单（须覆盖全章，不只章首）；',
  '4) 人物状态与关系连续性要求；',
  '5) 章首/章末衔接要求。',
  '若【叙事上下文】含【前章衔接】/【下章衔接】，方案须兼顾章首承接与前章、章末过渡至下章开头。',
].join('\n');

export function buildSegmentDiagnosisUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  segment: Segment;
  totalSegments: number;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
  boundaryAnchors?: SegmentBoundaryAnchors;
}): string {
  const {
    chapter,
    instruction,
    segment,
    totalSegments,
    appearingCharacters,
    selectedRelationEvents,
    boundaryAnchors,
  } = input;
  const sections: string[] = [];

  sections.push(
    `【诊断目标】第${chapter.chapterNo}章「${chapter.title}」第 ${segment.index + 1}/${totalSegments} 段局部诊断`
  );
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  if (boundaryAnchors) {
    sections.push(formatBoundaryAnchorsBlock(boundaryAnchors, segment.index));
  }

  sections.push(
    `<segment-original segment="${segment.index + 1}/${totalSegments}">\n${segment.originalText}\n</segment-original>`
  );
  sections.push(
    '请输出本段结构化诊断报告（控制在 200～400 字），禁止输出正文或整章方案。'
  );

  return sections.join('\n\n');
}

export function buildPlanSynthesisUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  segmentDiagnoses: Array<{ segmentIndex: number; diagnosisText: string }>;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, segmentDiagnoses, appearingCharacters, selectedRelationEvents } =
    input;
  const sections: string[] = [];

  sections.push(
    `【汇总目标】请把以下分段诊断汇总为第${chapter.chapterNo}章「${chapter.title}」的完整优化方案。`
  );
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  const diagnosisBlock = segmentDiagnoses
    .map(
      (item) =>
        `### 第 ${item.segmentIndex} 段诊断\n${item.diagnosisText.trim()}`
    )
    .join('\n\n');
  sections.push(`<segment-diagnoses>\n${diagnosisBlock}\n</segment-diagnoses>`);
  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${chapter.content}\n</chapter-original>`
  );
  sections.push(
    [
      '请基于分段诊断与原文输出完整整章优化方案，结构化呈现要点，禁止直接输出新的正文。',
      '不要机械拼接分段报告：须去重、合并同类问题并按全章节奏重新统筹，同时保证每段扫描出的有效问题都有明确去向。',
    ].join('\n')
  );

  return sections.join('\n\n');
}

const PLACEHOLDER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '（此处省略）', pattern: /（此处省略）/u },
  { label: '[原段落保留]', pattern: /\[原段落保留\]/u },
  { label: '原文保留', pattern: /原文保留/u },
  { label: '此处略', pattern: /此处略/u },
  { label: '原段落保留', pattern: /原段落保留/u },
  { label: '同上', pattern: /(?<!合)同上(?!述)/u },
  { label: '同前', pattern: /(?<![\p{Script=Han}])同前(?![\p{Script=Han}])/u },
];

export function detectPlaceholderText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  for (const item of PLACEHOLDER_PATTERNS) {
    if (item.pattern.test(trimmed)) {
      return item.label;
    }
  }
  return null;
}

export interface ChapterOptimizeQualityCheckResult {
  passed: boolean;
  failures: string[];
}

/**
 * 合并正文有效性校验。
 *
 * 只判断输出能不能用（空输出、占位语），不裁决改动幅度。
 * 改多改少由【用户优化要求】与优化方案决定，系统不设字数或段落数门槛。
 */
export function validateMergedChapterDraft(input: {
  mergedDraft: string;
}): ChapterOptimizeQualityCheckResult {
  const failures: string[] = [];
  const merged = input.mergedDraft.trim();

  if (!merged) {
    failures.push('合并正文为空');
    return { passed: false, failures };
  }

  const placeholder = detectPlaceholderText(merged);
  if (placeholder) {
    failures.push(`合并正文含占位语（${placeholder}）`);
  }

  return { passed: failures.length === 0, failures };
}

export interface ChapterDraftChangeRate {
  originalParagraphs: number;
  draftParagraphs: number;
  unchangedParagraphs: number;
  unchangedRatio: number;
  originalChars: number;
  draftChars: number;
}

/**
 * 改动量只读指标：逐段比对原文与改写稿，统计有多少段一字未动。
 *
 * 仅用于日志与展示，不参与任何通过/失败判定。
 */
export function measureChapterDraftChangeRate(
  originalContent: string,
  draftContent: string
): ChapterDraftChangeRate {
  const originalParagraphs = splitChapterParagraphs(originalContent);
  const draftParagraphs = splitChapterParagraphs(draftContent);
  const draftSet = new Set(draftParagraphs.map((text) => text.trim()));
  let unchangedParagraphs = 0;
  for (const paragraph of originalParagraphs) {
    if (draftSet.has(paragraph.trim())) {
      unchangedParagraphs += 1;
    }
  }
  return {
    originalParagraphs: originalParagraphs.length,
    draftParagraphs: draftParagraphs.length,
    unchangedParagraphs,
    unchangedRatio: originalParagraphs.length ? unchangedParagraphs / originalParagraphs.length : 0,
    originalChars: originalContent.trim().length,
    draftChars: draftContent.trim().length,
  };
}

export function countNonEmptyParagraphs(text: string): number {
  return splitChapterParagraphs(text).length;
}

export function mergeSegmentDraftTexts(segmentTexts: string[]): string {
  return segmentTexts
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function buildDraftUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  sourceText?: string;
  reviewGaps?: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, planText, appearingCharacters, selectedRelationEvents } = input;
  const sourceText = input.sourceText?.trim() ?? '';
  const originalForPrompt = sourceText || chapter.content;
  const sections: string[] = [];

  sections.push(
    `【写作目标】请按已确认的优化方案重写第${chapter.chapterNo}章「${chapter.title}」的正文。`
  );
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<optimization-plan chapter-no="${chapter.chapterNo}">\n${planText.trim()}\n</optimization-plan>`
  );
  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${originalForPrompt}\n</chapter-original>`
  );

  if (sourceText) {
    sections.push(DRAFT_REFINE_USER_CONSTRAINT);
  }

  const reviewGaps = input.reviewGaps?.trim() ?? '';
  if (reviewGaps) {
    sections.push(`【冻结合同未落实缺口】\n${reviewGaps}`);
    sections.push(DRAFT_REVIEW_GAPS_CONSTRAINT);
  }

  sections.push(
    [
      '请直接输出「优化后的章节正文」纯文本，不要输出方案、说明、Markdown 标题或代码块。',
      '按 <optimization-plan> 与【用户优化要求】对正文做实质性重写，按方案整体意图改写。',
      '禁止因「方案未点名具体句子 / 没有落点」而大段照抄；改动幅度由要求与方案决定，不必迁就原文篇幅或段落数。',
      '须保留情节节点、对白含义、人物动作与指代关系；措辞、句式、感官密度可大胆重写。',
    ].join('\n')
  );

  return sections.join('\n\n');
}

export function buildDirectDraftUserPrompt(input: {
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
}): string {
  const { chapter, instruction, appearingCharacters, selectedRelationEvents } = input;
  const sections: string[] = [];

  sections.push(
    `【写作目标】请按用户优化要求重写第${chapter.chapterNo}章「${chapter.title}」的正文。`
  );
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, index) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${index + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  sections.push(
    `<chapter-original chapter-no="${chapter.chapterNo}">\n${chapter.content}\n</chapter-original>`
  );

  sections.push(
    [
      '请直接输出「优化后的章节正文」纯文本，不要输出方案、说明、Markdown 标题或代码块。',
      '必须基于 <chapter-original> 改写，保留情节节点、对白含义、人物动作与指代关系；禁止大段原样照抄。',
      '改动幅度由【用户优化要求】决定：该大改就大改，该扩就扩，该收紧就收紧，不必迁就原文的篇幅或段落数。',
    ].join('\n')
  );

  return sections.join('\n\n');
}

/**
 * 章节版本乐观锁：把传入的 ISO 字符串与当前章节 updatedAt 做毫秒级比对。
 * 比对失败抛出 `CHAPTER_VERSION_CONFLICT`，service 层将其映射为业务错误码 1307。
 */
export class ChapterVersionConflictError extends Error {
  constructor(
    public readonly chapterNo: number,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`章节第${chapterNo}章版本不匹配：expected=${expected} actual=${actual}`);
    this.name = 'ChapterVersionConflictError';
  }
}

export function parseExpectedUpdatedAt(value: unknown): Date {
  if (!value || typeof value !== 'string') {
    throw new Error('expectedChapterUpdatedAt 必须为 ISO 时间字符串');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('expectedChapterUpdatedAt 不是合法的 ISO 时间字符串');
  }
  return parsed;
}

export function ensureChapterVersionMatches(chapterNo: number, expected: Date, actual: Date): void {
  if (expected.getTime() !== actual.getTime()) {
    throw new ChapterVersionConflictError(chapterNo, expected.toISOString(), actual.toISOString());
  }
}

/**
 * 用稳定的伪随机生成 planId / draftId，便于 trace 关联。
 */
export function makeOptimizationId(
  prefix: 'plan' | 'draft' | 'typo-check' | 'typo-fix' | 'auto-loop' | 'review'
): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChapterTypoIssueRecord {
  id: string;
  original: string;
  suggestion: string;
  context?: string;
  reason?: string;
}

export const CHAPTER_OPTIMIZE_TYPO_CHECK_TEMPLATE_KEY = 'chapter.optimize.typo-check';
export const CHAPTER_OPTIMIZE_TYPO_FIX_TEMPLATE_KEY = 'chapter.optimize.typo-fix';

export const CHAPTER_OPTIMIZE_TYPO_CHECK_SYSTEM_PROMPT = [
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
].join('\n');

export const CHAPTER_OPTIMIZE_TYPO_FIX_SYSTEM_PROMPT = [
  '你是一位资深中文小说校对编辑，正在将错字修正建议全部应用到章节草稿正文中。',
  '本步骤需要直接输出「修正后的完整正文」纯文本，不要输出 JSON、方案、说明或 Markdown。',
  '硬约束：',
  '1) 必须应用 <typo-issues> 中的全部修正建议；',
  '2) 除错字修正外，不得擅自改写情节、人物对白或段落结构；',
  '3) 不得使用占位语；',
  '4) 保持原文语言风格、人称与时态。',
].join('\n');

export function buildTypoCheckUserPrompt(draftText: string): string {
  return [
    '【待检查正文】',
    `<draft-text>\n${draftText.trim()}\n</draft-text>`,
    '请检查以上正文中的错别字与明显语病，按约定 JSON 格式输出 issues 列表。',
  ].join('\n\n');
}

export function buildTypoFixUserPrompt(
  draftText: string,
  issues: ChapterTypoIssueRecord[]
): string {
  const issueLines =
    issues.length > 0
      ? issues
          .map(
            (issue, index) =>
              `${index + 1}. [${issue.id}] 「${issue.original}」→「${issue.suggestion}」${issue.reason ? `（${issue.reason}）` : ''}`
          )
          .join('\n')
      : '（无待修正项，请原样输出正文）';

  return [
    '【修正要求】请将以下全部错字建议应用到正文，并输出修正后的完整正文。',
    `<typo-issues>\n${issueLines}\n</typo-issues>`,
    `<draft-text>\n${draftText.trim()}\n</draft-text>`,
    '请直接输出修正后的完整正文纯文本。',
  ].join('\n\n');
}

export interface Segment {
  index: number;
  originalText: string;
  planExcerpt: string;
  startParagraph: number;
  endParagraph: number;
}

export interface SegmentBoundaryAnchors {
  previousOriginalLastSentence?: string;
  currentOriginalFirstSentence: string;
  currentOriginalLastSentence: string;
  nextOriginalFirstSentence?: string;
}

export interface SegmentPromptInput {
  segment: Segment;
  chapter: ChapterOptimizeChapterRef;
  instruction: string;
  planText: string;
  appearingCharacters?: string[];
  selectedRelationEvents?: ChapterOptimizeUsedRelationEvent[];
  previousSegmentSummary?: string;
  /** 上一段已生成正文的末尾片段，用于语气/场景衔接 */
  previousSegmentTail?: string;
  /** 原文边界句锚点（情节范围） */
  boundaryAnchors?: SegmentBoundaryAnchors;
  totalSegments: number;
  omitOptimizationPlan?: boolean;
  reviewGaps?: string;
}

export function splitChapterParagraphs(content: string): string[] {
  return content.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

const SENTENCE_SPLIT_RE = /(?<=[。！？…])/;

export function extractFirstSentence(text: string, fallbackChars = 80): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts[0]!;
  }
  return trimmed.length <= fallbackChars ? trimmed : `${trimmed.slice(0, fallbackChars)}…`;
}

export function extractLastSentence(text: string, fallbackChars = 80): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const parts = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts[parts.length - 1]!;
  }
  return trimmed.length <= fallbackChars ? trimmed : `…${trimmed.slice(-fallbackChars)}`;
}

export function buildSegmentBoundaryAnchors(
  segment: Segment,
  allSegments: Segment[]
): SegmentBoundaryAnchors {
  const currentOriginalFirstSentence = extractFirstSentence(segment.originalText);
  const currentOriginalLastSentence = extractLastSentence(segment.originalText);

  const previousSegment = segment.index > 0 ? allSegments[segment.index - 1] : undefined;
  const nextSegment =
    segment.index < allSegments.length - 1 ? allSegments[segment.index + 1] : undefined;

  return {
    previousOriginalLastSentence: previousSegment
      ? extractLastSentence(previousSegment.originalText)
      : undefined,
    currentOriginalFirstSentence,
    currentOriginalLastSentence,
    nextOriginalFirstSentence: nextSegment
      ? extractFirstSentence(nextSegment.originalText)
      : undefined,
  };
}

export function resolveOptimizeSegmentCount(
  contentLength: number,
  maxSegments?: number,
  config: ChapterOptimizeConfig = resolveChapterOptimizeConfig()
): number {
  const segmentCount = resolveChapterOptimizeSegmentCount(contentLength, config);
  if (maxSegments !== undefined) {
    return Math.min(segmentCount, Math.max(1, Math.trunc(maxSegments)));
  }
  return segmentCount;
}

export function extractSegmentTailText(
  text: string,
  maxChars = SEGMENT_TAIL_CONTEXT_CHARS
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return trimmed.slice(-maxChars);
}

export function extractSegmentLeadText(
  text: string,
  maxChars = SEGMENT_LEAD_CONTEXT_CHARS
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  const firstParagraph = trimmed.split(/\n\n+/)[0]?.trim() || trimmed;
  if (firstParagraph.length <= maxChars) {
    return firstParagraph;
  }
  return `${firstParagraph.slice(0, maxChars)}…`;
}

function scoreParagraphBreakPoint(paragraph: string, nextParagraph?: string): number {
  let score = 0;
  const trimmed = paragraph.trim();
  if (/[。！？…]["”』」]?$/.test(trimmed)) {
    score += 3;
  }
  if (nextParagraph && /^[「『"'“]/.test(nextParagraph.trim())) {
    score += 2;
  }
  if (trimmed.length < 40) {
    score -= 1;
  }
  return score;
}

function pickBreakParagraphIndex(
  paragraphs: string[],
  targetEnd: number,
  searchRadius = 2
): number {
  const min = Math.max(0, targetEnd - searchRadius);
  const max = Math.min(paragraphs.length - 1, targetEnd + searchRadius);
  let best = targetEnd;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = min; i <= max; i += 1) {
    const score = scoreParagraphBreakPoint(paragraphs[i] || '', paragraphs[i + 1]);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const SEGMENT_SUMMARY_PREFIX = '【SEG_SUMMARY】';

export function splitIntoSegments(content: string, planText: string, maxSegments = 3): Segment[] {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return [];
  }
  const effectiveMax = Math.max(1, Math.trunc(maxSegments));
  if (effectiveMax <= 1) {
    const paragraphs = trimmedContent.split(/\n\n+/).filter((p) => p.trim().length > 0);
    return [
      {
        index: 0,
        originalText: trimmedContent,
        planExcerpt: planText,
        startParagraph: 0,
        endParagraph: Math.max(0, paragraphs.length - 1),
      },
    ];
  }

  const paragraphs = trimmedContent.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) {
    return [];
  }
  if (paragraphs.length <= effectiveMax) {
    return paragraphs.map((p, i) => ({
      index: i,
      originalText: p.trim(),
      planExcerpt: planText,
      startParagraph: i,
      endParagraph: i,
    }));
  }

  const segSize = Math.ceil(paragraphs.length / effectiveMax);
  const adjustedSegments: Array<{ start: number; end: number }> = [];

  for (let start = 0; start < paragraphs.length; ) {
    const targetEnd = Math.min(start + segSize, paragraphs.length) - 1;
    let end =
      adjustedSegments.length < effectiveMax - 1
        ? pickBreakParagraphIndex(paragraphs, targetEnd)
        : paragraphs.length - 1;
    end = Math.max(start, Math.min(end, paragraphs.length - 1));

    if (adjustedSegments.length === 0) {
      adjustedSegments.push({ start, end });
    } else {
      const prev = adjustedSegments[adjustedSegments.length - 1]!;
      const nextStart = prev.end + 1;
      if (nextStart >= paragraphs.length) {
        break;
      }
      end = Math.max(nextStart, end);
      adjustedSegments.push({ start: nextStart, end });
    }

    start = end + 1;
    if (adjustedSegments.length >= effectiveMax) {
      break;
    }
  }

  const last = adjustedSegments[adjustedSegments.length - 1];
  if (last && last.end < paragraphs.length - 1) {
    last.end = paragraphs.length - 1;
  }

  return adjustedSegments.map((seg, index) => {
    const text = paragraphs.slice(seg.start, seg.end + 1).join('\n\n');
    return {
      index,
      originalText: text.trim(),
      planExcerpt: planText,
      startParagraph: seg.start,
      endParagraph: seg.end,
    };
  });
}

function formatBoundaryAnchorsBlock(anchors: SegmentBoundaryAnchors, segmentIndex: number): string {
  const lines = [
    '【边界锚点·只读】',
    '用途：只锁情节起止边界，不限制本段内部如何改写。措辞、句式、感官密度可按方案/要求大胆重写。',
  ];
  if (anchors.previousOriginalLastSentence) {
    lines.push(
      `- 上段原文末句：「${anchors.previousOriginalLastSentence}」（本段须从此句之后自然承接，不得重复该句）`
    );
  } else if (segmentIndex > 0) {
    lines.push('- 上段原文末句：（无，本段为章节后续部分）');
  }
  lines.push(
    `- 本段原文首句：「${anchors.currentOriginalFirstSentence}」（段首情节从此附近起笔即可，允许完全重写措辞）`
  );
  lines.push(
    `- 本段原文末句：「${anchors.currentOriginalLastSentence}」（段末情节落在此附近即可，不得写到更后情节；允许完全重写措辞）`
  );
  if (anchors.nextOriginalFirstSentence) {
    lines.push(
      `- 下段原文首句：「${anchors.nextOriginalFirstSentence}」（禁止提前写入；本段不得出现该句之后的情节或章末式收束）`
    );
  }
  return lines.join('\n');
}

export function buildSegmentPrompt(input: SegmentPromptInput): string {
  const {
    segment,
    chapter,
    instruction,
    planText,
    appearingCharacters,
    selectedRelationEvents,
    previousSegmentSummary,
    previousSegmentTail,
    boundaryAnchors,
    totalSegments,
    omitOptimizationPlan,
    reviewGaps,
  } = input;

  const sections: string[] = [];
  const isMiddleSegment =
    totalSegments > 2 && segment.index > 0 && segment.index < totalSegments - 1;

  sections.push(
    `【系统指令】当前正在生成第 ${segment.index + 1}/${totalSegments} 段。请对本段全文做可见改写，保留情节信息，但禁止前半改、后半抄。`
  );

  if (totalSegments > 1) {
    sections.push(
      '【衔接要求】本段须与前后段在时序、场景、人称上自然连贯；段首勿重复前段已写内容，段末勿写「总之」「与此同时」等收束句。'
    );
    if (segment.startParagraph === segment.endParagraph) {
      sections.push(
        `【本段范围】仅改写原文第 ${segment.startParagraph + 1} 段（以空行分段计），不得写到其他段落的情节；范围内允许大胆重写措辞与密度。`
      );
    } else {
      sections.push(
        `【本段范围】仅改写原文第 ${segment.startParagraph + 1}–${segment.endParagraph + 1} 段（以空行分段计），不得写到其他段落的情节；范围内允许大胆重写措辞与密度。`
      );
    }
  }

  if (isMiddleSegment) {
    sections.push(
      '【中段专用】本段不是章节结尾。禁止写成章末式收束，禁止写下一段已发生的事件或对白；段内情绪与感官密度不设上限。'
    );
  }

  sections.push(`【章节信息】第${chapter.chapterNo}章「${chapter.title}」`);
  sections.push(`【用户优化要求】\n${instruction}`);

  if (appearingCharacters && appearingCharacters.length > 0) {
    sections.push(`【本章出场角色】${appearingCharacters.join('、')}`);
  }

  if (selectedRelationEvents && selectedRelationEvents.length > 0) {
    const lines = selectedRelationEvents.map((event, i) => {
      const chapterTag =
        typeof event.chapterNo === 'number' && event.chapterNo > 0
          ? `（第${event.chapterNo}章）`
          : '';
      return `${i + 1}. ${event.protagonist} ↔ ${event.counterparty}${chapterTag}：${event.summary}`;
    });
    sections.push(`【关联关系事件】\n${lines.join('\n')}`);
  }

  if (!omitOptimizationPlan) {
    sections.push(`<optimization-plan>\n${(planText ?? '').trim()}\n</optimization-plan>`);
  }

  const localPlan = omitOptimizationPlan ? '' : segment.planExcerpt?.trim();
  if (localPlan && localPlan !== (planText ?? '').trim()) {
    sections.push(`<segment-local-plan>\n${localPlan}\n</segment-local-plan>`);
  }

  if (boundaryAnchors) {
    sections.push(formatBoundaryAnchorsBlock(boundaryAnchors, segment.index));
  }

  if (previousSegmentTail) {
    sections.push(
      `【前段末文（语气参考，不要照抄；情节边界以上方「边界锚点」为准）】\n${previousSegmentTail}`
    );
  }

  if (previousSegmentSummary) {
    sections.push(`【前段情节摘要】\n${previousSegmentSummary}`);
  }

  const gapText = reviewGaps?.trim() ?? '';
  if (gapText) {
    sections.push(`【冻结合同未落实缺口】\n${gapText}`);
    sections.push(DRAFT_REVIEW_GAPS_CONSTRAINT);
  }

  sections.push(`<segment-original>\n${segment.originalText}\n</segment-original>`);

  sections.push(
    [
      '请只输出优化后的本段正文，不要附加摘要、说明或其他元信息。',
      '改写要求：按【用户优化要求】与（若有）优化方案对本段从头到尾重写；保留情节节点、对白含义与人物动作，但禁止大段照抄原文。',
      '禁止「前半改写、后半原样粘贴」；不得以「方案未点名本段句子」为由几乎不动。',
      '不得使用「同上」「同前」「此处省略」「原段落保留」等占位语；禁止原样输出本段原文。',
    ].join('\n')
  );

  return sections.join('\n\n');
}

export function parseSegmentOutput(output: string): { segmentText: string; summary: string } {
  const summaryIndex = output.lastIndexOf(SEGMENT_SUMMARY_PREFIX);
  if (summaryIndex === -1) {
    const trimmed = output.trim();
    const lastSentence =
      trimmed
        .split(/[。！？\n]/)
        .filter(Boolean)
        .pop() || trimmed.slice(-80);
    return { segmentText: trimmed, summary: lastSentence };
  }
  const segmentText = output.slice(0, summaryIndex).trim();
  const summary = output.slice(summaryIndex + SEGMENT_SUMMARY_PREFIX.length).trim();
  return { segmentText, summary };
}

export function calculateSegmentMaxTokens(originalText: string): number {
  const charCount = originalText.length;
  // 中文约 1.5–2 字/token；给足扩写余量，避免写到后半被 max_tokens 掐断后回抄原文
  const estimated = Math.ceil(charCount * 2.5);
  return Math.max(
    CHAPTER_OPTIMIZE_MIN_MAX_TOKENS,
    Math.min(estimated, CHAPTER_OPTIMIZE_MAX_MAX_TOKENS)
  );
}

export function calculateSegmentMaxTokensForIndex(
  originalText: string,
  _segmentIndex: number,
  _totalSegments: number
): number {
  return calculateSegmentMaxTokens(originalText);
}

export function shouldRetrySegmentForLength(originalText: string, generatedText: string): boolean {
  const originalLen = originalText.trim().length;
  if (originalLen <= 0) {
    return false;
  }
  return generatedText.trim().length > originalLen * SEGMENT_LENGTH_RETRY_RATIO;
}

export function appendSegmentLengthRetryHint(prompt: string): string {
  return `${prompt}\n\n【重试约束】上次输出越出了本段情节边界（写入了下段情节或章末式收束）。请仍按方案/要求大胆改写本段，但情节落点须停在本段原文末句附近，删除下段情节；不要为了缩短而压缩已写好的改写密度。`;
}

export function parseTypoCheckIssues(raw: unknown): ChapterTypoIssueRecord[] {
  let payload = raw;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1].trim() : trimmed;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return [];
    }
  }

  const items = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { issues?: unknown[] }).issues)
      ? (payload as { issues: unknown[] }).issues
      : [];

  const issues: ChapterTypoIssueRecord[] = [];
  let index = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const original = typeof record.original === 'string' ? record.original.trim() : '';
    const suggestion = typeof record.suggestion === 'string' ? record.suggestion.trim() : '';
    if (!original || !suggestion || original === suggestion) {
      continue;
    }
    index += 1;
    const id =
      typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `issue-${index}`;
    const context = typeof record.context === 'string' ? record.context.trim() : undefined;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : undefined;
    issues.push({
      id,
      original,
      suggestion,
      context: context || undefined,
      reason: reason || undefined,
    });
  }

  return issues;
}
