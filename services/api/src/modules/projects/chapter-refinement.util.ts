/**
 * 章节精修编排（AQ-381）—— 新模板 key、分阶段 Prompt 拼装、输出合同校验与程序门禁。
 *
 * 纯函数，不依赖 Nest / 网络，便于单测。设计见
 * openspec/changes/add-chapter-refinement-orchestration/{prompt-design.md,design.md}。
 *
 * 模板治理同步入口：
 *  - `packages/prompt-templates/src/templates.ts`（基础登记，默认 draft）
 *  - `services/api/src/modules/task-prompts/task-prompt-defaults.ts`（运行时白名单种子）
 *  - `services/rag-orchestrator/src/generation/task-prompt-defaults.ts`（orchestrator 兜底镜像）
 * 三处文本必须一致，任何一边变更都要同步。
 */

import { createHash } from 'node:crypto';
import {
  isRefinementUtilityStageTemplateKey,
  isRefinementWritingStageTemplateKey,
} from '@aether-quill/config';

import type { RefinementCoverage } from './chapter-refinement.types';

export const CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY = 'chapter.refinement.inspect';
export const CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY = 'chapter.refinement.plan';
export const CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY = 'chapter.refinement.rewrite';
export const CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY = 'chapter.refinement.review';
export const CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY = 'chapter.refinement.repair';

// 档位的唯一来源是 packages/config 的模板键判定（orchestrator 组装最终消息时用同一判定），
// 这里只按它分桶，避免 api 与 orchestrator 各写一份列表而漂移。
export const CHAPTER_REFINEMENT_TEMPLATE_KEYS: readonly string[] = [
  CHAPTER_REFINEMENT_INSPECT_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_PLAN_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REVIEW_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REWRITE_TEMPLATE_KEY,
  CHAPTER_REFINEMENT_REPAIR_TEMPLATE_KEY,
];

/** utility 阶段（不注入文风样本与长写作指导） */
export const CHAPTER_REFINEMENT_UTILITY_TEMPLATE_KEYS: readonly string[] =
  CHAPTER_REFINEMENT_TEMPLATE_KEYS.filter(isRefinementUtilityStageTemplateKey);

/** writing 阶段（注入冻结的项目文风与样本） */
export const CHAPTER_REFINEMENT_WRITING_TEMPLATE_KEYS: readonly string[] =
  CHAPTER_REFINEMENT_TEMPLATE_KEYS.filter(isRefinementWritingStageTemplateKey);

/** 正文输出 token 预算：中文约 1.5–2 字/token，按单场字数上限给足扩写余量。 */
export function resolveRefinementRewriteMaxTokens(maxChars: number): number {
  // 中文改写产出的经验比约 1 token/字；1.5× 是保守但可用的上限（2.5× 会把正常的
  // 3500+ 字范围误判为「超出单次输出上限」而永远无法改写）。
  const estimated = Math.ceil(Math.max(1, maxChars) * 1.5);
  return Math.max(4096, Math.min(estimated, 65536));
}

// ── F6：完整输入的保守预算 ─────────────────────────────────────────────

/** 供应商上下文窗口的保守默认（未冻结模型路由时使用，单位 token） */
export const REFINEMENT_PROVIDER_CONTEXT_TOKENS = 128_000;
/** 供应商单次输出上限的保守默认（未冻结模型路由时使用，单位 token） */
export const REFINEMENT_PROVIDER_MAX_OUTPUT_TOKENS = 65_536;
/** 为多轮对话 / 供应商内部开销预留的安全余量（token） */
const REFINEMENT_CONTEXT_SAFETY_TOKENS = 4_096;

/**
 * F6：显式模型能力配置。
 *
 * 不再对「所有同 provider 的模型」假定同一个上限，也不对未登记模型猜测默认值——
 * 预算必须按 run 冻结的**实际 provider + model** 组合解析；未登记组合返回 null，
 * 由引擎走「不可判断路径」暂停（绝不静默放行）。键为 `${provider}/${model}`。
 */
export interface RefinementModelCapability {
  contextTokens: number;
  maxOutputTokens: number;
}

const REFINEMENT_MODEL_CAPABILITIES: Record<string, RefinementModelCapability> = {
  // conservative 取值：宁可低估可用余量，也不冒超出供应商上下文 / 单次输出上限的风险
  'deepseek/deepseek-chat': { contextTokens: 64_000, maxOutputTokens: 8_192 },
  'deepseek/deepseek-v4-flash': { contextTokens: 64_000, maxOutputTokens: 8_192 },
  // DeepSeek official limits verified 2026-10-07: 1M context, max_tokens <= 393216.
  // Use decimal 1M conservatively; call budgets still request only the necessary output.
  // https://api-docs.deepseek.com/quick_start/pricing/
  // https://api-docs.deepseek.com/api/create-chat-completion/
  'deepseek/deepseek-v4-pro': { contextTokens: 1_000_000, maxOutputTokens: 393_216 },
  'deepseek/deepseek-reasoner': { contextTokens: 64_000, maxOutputTokens: 8_192 },
  'siliconflow/deepseek-ai/DeepSeek-V3': { contextTokens: 32_768, maxOutputTokens: 8_192 },
  'siliconflow/deepseek-ai/DeepSeek-V3.2': { contextTokens: 32_768, maxOutputTokens: 8_192 },
};

/**
 * 解析冻结模型路由的能力：必须同时匹配 provider 与 model；任一缺失或未登记都返回 null
 * （调用方按不可判断路径暂停，而不是回落到 provider 级猜测值）。
 */
export function resolveRefinementModelCapability(route?: {
  provider?: string;
  model?: string;
}): RefinementModelCapability | null {
  const provider = route?.provider?.trim().toLowerCase();
  const model = route?.model?.trim();
  if (!provider || !model) {
    return null;
  }
  return REFINEMENT_MODEL_CAPABILITIES[`${provider}/${model}`] ?? null;
}

/**
 * 输入 token 保守估算：中文约 1.6 字/token；这里按 1.1 token/字 高估，并计固定结构开销，
 * 宁可低估可用余量也不冒超出供应商上下文的风险。
 */
export function estimateRefinementInputTokens(inputChars: number): number {
  return Math.ceil(Math.max(0, inputChars) * 1.1) + 512;
}

export interface RefinementCallBudget {
  ok: boolean;
  /** 允许的输出 token 上限（ok=true 时给出） */
  maxTokens?: number;
  reason?: string;
}

/**
 * F6：结构化输出（inspect / plan / review）合同的保守 token 预算。
 *
 * 这些调用输出的是固定结构的 JSON，与目标正文长度无关；用正文输出预算会高估所需余量，
 * 也会诱导按正文规模静默裁剪，故单独给出合同规模的固定预算。
 */
export const REFINEMENT_STRUCTURED_OUTPUT_TOKENS = 4_096;

/**
 * plan 阶段必要输出 token 的规模系数与边界。
 *
 * plan 输出规模**正比于合并后的场景数**（不是 block 数），且受每个场景的入场/散场事实数、
 * 引文长度、保护 span 与检查项影响。固定 4096 对短章合适，但对多场景长章会因
 * `finishReason=length` 被截断（长章合并场景后仍需逐场给足 fact 证据与编辑意图）。
 *
 * 因此 plan 单独估算必要输出，不与 inspect/review 共用固定预算，也不照用正文长度
 * （正文长度与场景数没有稳定关系，照用会把必要输出虚高、诱导静默裁剪）。
 */

/** plan 输出的固定结构开销：顶层 chapterIntent + protectedFacts + JSON 骨架（token） */
const REFINEMENT_PLAN_BASE_TOKENS = 1_024;
/** 每个合并场景的固定开销：sceneId + decision + reason + editIntent + expectedChange + targetLength + 骨架 */
const REFINEMENT_PLAN_PER_SCENE_BASE_TOKENS = 256;
/** 每个 sourceBlockId 引用的开销：`"b123",` 的列表项平均 token */
const REFINEMENT_PLAN_PER_BLOCK_ID_TOKENS = 8;
/** 每个事实的固定结构开销：`{"key":..,"value":..,"sourceBlockId":..,"anchorQuote":..}` 骨架 */
const REFINEMENT_PLAN_PER_FACT_BASE_TOKENS = 32;
/** 引文每个字符折算 token（中文 1 token/字左右，保守取 1.5 字/token 的倒数方向：按字数上界） */
const REFINEMENT_PLAN_QUOTE_TOKENS_PER_CHAR = 1;
/** 每个 check 项开销：`{"targetBlockId":..,"expectedFact":..}` */
const REFINEMENT_PLAN_PER_CHECK_TOKENS = 32;
/** plan 必要输出下限：短章/单场仍保证与历史固定预算一致，不因估算偏低而缩小 */
const REFINEMENT_PLAN_MIN_TOKENS = 4_096;
/** plan 必要输出上限：超出即按 F6 门禁拒绝/转分片，不静默钳低（V4 Pro 远大于此，不构成实际约束） */
export const REFINEMENT_PLAN_MAX_TOKENS = 65_536;

/**
 * 估算 plan 阶段的必要输出 token：由合并场景数、事实数与引文长度决定，非固定 4096。
 *
 * 输入来自 `mergeWindowSceneFragments` 的产物（`RefinementMergedScene[]`）——每个场景携带
 * 合并后的 fragments（含 entryFacts / exitFacts，其 anchorQuote 长度即引文开销）。
 *
 * 保守高估：宁可多给余量，也不冒 `length` 截断的风险；仍受 `REFINEMENT_PLAN_MAX_TOKENS` 钳制，
 * 超出由调用方按 F6 门禁处理（拒绝或转分片），不在此处静默裁剪。
 */
export function resolveRefinementPlanOutputTokens(
  blocks: readonly RefinementSourceBlock[],
  scenes: readonly RefinementMergedScene[]
): number {
  let tokens = REFINEMENT_PLAN_BASE_TOKENS;
  for (const scene of scenes) {
    tokens += REFINEMENT_PLAN_PER_SCENE_BASE_TOKENS;
    // 该场景覆盖的 block id 引用开销
    tokens +=
      Math.max(0, scene.endBlockIndex - scene.startBlockIndex) *
      REFINEMENT_PLAN_PER_BLOCK_ID_TOKENS;
    // 事实与引文：只统计合并后仍保留的 fragments（含 entryFacts / exitFacts）
    for (const fragment of scene.fragments) {
      for (const fact of [...fragment.entryFacts, ...fragment.exitFacts]) {
        tokens += REFINEMENT_PLAN_PER_FACT_BASE_TOKENS;
        if (fact.value !== null && typeof fact.anchorQuote === 'string') {
          tokens += Math.ceil(fact.anchorQuote.length * REFINEMENT_PLAN_QUOTE_TOKENS_PER_CHAR);
        }
      }
    }
  }
  // 每个场景通常至少一条 check（除非 keep）；按场景数保守计一条 check 开销
  tokens += scenes.length * REFINEMENT_PLAN_PER_CHECK_TOKENS;
  return Math.max(REFINEMENT_PLAN_MIN_TOKENS, Math.min(REFINEMENT_PLAN_MAX_TOKENS, tokens));
}

/**
 * F6：按「完整最终消息 + 必要输出」做保守预算。
 *
 * - 输入含整条 user prompt（系统指导、原文、邻文、事实、冻结参考材料）与运行时附加材料；
 * - **必要输出**（`requiredOutputTokens`，缺省由期望输出推导）必须同时装进**上下文余量**与
 *   **单次输出上限**；任一不足即明确拒绝（暂停 / 重新规划安全范围），不再静默压低 maxTokens；
 * - 供应商能力由调用方按冻结 provider+model 显式传入，未登记即拒绝。
 */
export function resolveRefinementCallBudget(input: {
  promptChars: number;
  desiredOutputChars: number;
  /** 必要输出 token；缺省用 expectedOutputChars 推导。低于此值不得静默裁剪 */
  requiredOutputTokens?: number;
  /** 由显式模型能力传入；缺省用保守默认（仅在无冻结路由的兼容路径使用） */
  contextTokens?: number;
  maxOutputTokens?: number;
}): RefinementCallBudget {
  const contextTokens = input.contextTokens ?? REFINEMENT_PROVIDER_CONTEXT_TOKENS;
  const providerOutputCap = input.maxOutputTokens ?? REFINEMENT_PROVIDER_MAX_OUTPUT_TOKENS;
  const required =
    input.requiredOutputTokens ?? resolveRefinementRewriteMaxTokens(input.desiredOutputChars);
  const inputTokens = estimateRefinementInputTokens(input.promptChars);
  const available = contextTokens - inputTokens - REFINEMENT_CONTEXT_SAFETY_TOKENS;
  if (available < required) {
    return {
      ok: false,
      reason:
        `完整输入约 ${inputTokens} token，扣除后可用余量 ${Math.max(0, available)} token ` +
        `不足必要输出 ${required} token（上下文窗口 ${contextTokens} token）；拒绝裁剪，需重新规划安全范围或暂停`,
    };
  }
  // 单次输出上限是独立的硬约束：上下文再宽裕也不能靠它兜底装不下的必要输出
  if (providerOutputCap < required) {
    return {
      ok: false,
      reason:
        `必要输出 ${required} token 超过单次输出上限 ${providerOutputCap} token；` +
        `拒绝静默裁剪，需缩小目标范围或暂停`,
    };
  }
  return { ok: true, maxTokens: Math.min(required, providerOutputCap, available) };
}

/**
 * F6：把最终检查的范围按字符预算分组，保证大章也能分组覆盖，同时保留覆盖完成记录。
 * 单个范围超过预算时自成一组（不裁剪该范围原文）。
 */
export function groupRefinementRangesByBudget<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  maxChars: number
): T[][] {
  const limit = Math.max(1, Math.floor(maxChars));
  const groups: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const item of items) {
    const size = Math.max(0, sizeOf(item));
    if (current.length > 0 && currentChars + size > limit) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += size;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/** 供应商正常收束的结束原因；其余一律视为不可应用的完成状态。 */
export const REFINEMENT_ACCEPTED_FINISH_REASON = 'stop';

export type RefinementCompletionFailureKind =
  | 'incomplete_stream'
  | 'truncated'
  | 'filtered'
  | 'unknown_finish';

export interface RefinementCompletionFailure {
  kind: RefinementCompletionFailureKind;
  message: string;
}

/**
 * 严格完成判定：非空内容不等于成功（design D9 / R7）。
 *
 * 缺 end（断流）、length（截断）、content_filter（过滤）、未知或缺失 finishReason
 * 都不得作为可应用候选；只有显式 `stop` 才算完整收束。
 */
export function resolveRefinementCompletionFailure(input: {
  completed?: boolean;
  finishReason?: string | null;
  text: string;
}): RefinementCompletionFailure | null {
  if (input.completed !== true) {
    return { kind: 'incomplete_stream', message: '上游流未正常结束（缺少完成事件），候选不可用' };
  }
  const reason = typeof input.finishReason === 'string' ? input.finishReason.trim() : '';
  if (!reason) {
    return { kind: 'unknown_finish', message: '上游未返回结束原因，无法确认输出完整，候选不可用' };
  }
  if (reason === REFINEMENT_ACCEPTED_FINISH_REASON) {
    return null;
  }
  if (reason === 'length') {
    return { kind: 'truncated', message: '输出达到长度上限被截断，候选不可用' };
  }
  if (reason === 'content_filter') {
    return { kind: 'filtered', message: '输出被内容过滤中断，候选不可用' };
  }
  return { kind: 'unknown_finish', message: `未识别的结束原因「${reason}」，候选不可用` };
}

export const CHAPTER_REFINEMENT_INSPECT_SYSTEM_PROMPT = [
  '你是小说编辑助手，负责对一段章节原文做结构化诊断，为后续整章规划提供事实与问题。',
  '只输出严格 JSON，不要输出解释、Markdown 标题或代码块围栏。',
  '输出结构：',
  '{"windowId": string, "sceneFragments": [{"startBlockId": string, "endBlockId": string, "startsNewScene": boolean, "confidence": "high"|"low", "goal": string, "entryFacts": Fact[], "exitFacts": Fact[], "proposedBeatEnds": [{"blockId": string, "anchorQuote": string}]}], "issues": [{"sourceBlockId": string, "anchorQuote": string, "kind": "goal_gap"|"continuity"|"expression_regression", "why": string, "editIntent": string}]}',
  'Fact 为 {"key": string, "value": null} 或 {"key": string, "value": string, "sourceBlockId": string, "anchorQuote": string}。',
  '约束：',
  '1) 只诊断 <diagnosis-window> 内的内容；<read-only-neighbor> 仅作参考，不得作为修改目标或问题来源；',
  '2) 只指出本轮要求未落实、必要衔接缺陷、明显重复或表达退化；每项给出原文证据与一个可执行编辑意图；',
  '3) 必要事实无法在允许范围内确认时 value 置 null，不得虚构衣着、物件、伤势等；',
  '4) 没有问题则 issues 为空数组，不凑条目、不输出改写正文；',
  '5) anchorQuote 必须能在允许读取范围内唯一命中。',
].join('\n');

export const CHAPTER_REFINEMENT_PLAN_SYSTEM_PROMPT = [
  '你是小说编辑，负责把逐窗诊断汇总为一份整章编辑意图与相关场内意图。',
  '只输出严格 JSON，不要输出解释、Markdown 标题或代码块围栏。',
  '正常输出结构：',
  '{"chapterIntent": string, "protectedFacts": Fact[], "sceneBriefs": [{"sceneId": string, "sourceBlockIds": string[], "decision": "keep"|"patch"|"rewrite", "reason": string, "editIntent": string, "expectedChange": string, "entryFacts": Fact[], "exitFacts": Fact[], "protectedSpanIds": string[], "targetLength": {"direction": "hold"|"expand"|"condense", "minChars"?: number, "maxChars"?: number}, "checks": [{"targetBlockId": string, "expectedFact": string}]}]}',
  '当本轮要求超出改写权限（跨场移动事件、修改锁定散场状态、改动范围外正文）时，改为输出：',
  '{"boundaryConflict": {"reason": string, "detail": string}}',
  '约束：',
  '1) 所有 source blocks 必须归属某个场景并被 keep/patch/rewrite 覆盖；decision=keep 合法，不为修改率制造变化；',
  '2) 事实必须有可校验来源，未知保持 null；不得补造状态；',
  '3) 场内删除承载必要信息（情绪转折、伏笔）的拍时，editIntent 必须给出同场已验证的补偿落点；无法补偿则保留；',
  '4) 篇幅方向可以是方向性的，没有证据时不凭空给每拍配精确字数；',
  '5) 不得授权改变策略锁定的事实。',
  '6) Fact 的 sourceBlockId 与 anchorQuote 必须直接取自原文：anchorQuote 是从该 sourceBlockId 对应原文中逐字复制的连续片段，不得改写、概括、跨句拼接或补字；无法逐字复制的 Fact 一律 value=null。',
].join('\n');

export const CHAPTER_REFINEMENT_REWRITE_SYSTEM_PROMPT = [
  '你是小说编辑，按本次编辑交底改写当前范围，输出可直接拼回原文的正文。',
  '只输出当前范围正文，不输出方案、过程清单、标题、代码块或占位语。',
  '围绕人物此刻的目标与阻力推进。让情绪和主动权变化落在具体选择、对话、停顿及回应中；避免用叙述者总结替代过程。',
  '关键一拍写透最有辨识度的感受，过渡处保持速度。不同段落可转换感官焦点，优先准确细节，不凑感官数量，不重复同一种身体或情绪反应表示强度。',
  '动作须有清楚的位置与因果。心理可以直接绑定正在发生的事；不要为替换心理解释而制造不合理位移。句长随节奏变化，保留准确原词，删掉套话和无效重复。',
  '当前原文、首尾事实与逐字锁优先于文风建议；只读邻文不能改写、复述或并入输出。范围内怎样改按交底执行，不额外添加后文情节，不把中段写成章末。',
  '重写后本范围的信息量与感官密度不得低于原文对应部分：禁止摘要式压缩，禁止为「更通顺」抽薄描写。收紧篇幅只针对重复、套话与无效修饰，不得删掉承载情节、情绪或感官的具体细节；交底或用户明确要求删除的除外。',
].join('\n');

export const CHAPTER_REFINEMENT_REVIEW_SYSTEM_PROMPT = [
  '你是小说编辑检查员，对照冻结原文、候选正文、场内交底与逐字锁检查本次改写结果。',
  '只输出严格 JSON，不要输出解释、Markdown 标题或代码块围栏。',
  '输出结构：',
  '{"issues": [{"kind": "hard_constraint"|"continuity"|"style"|"coverage", "severity": "high"|"medium"|"low", "anchorQuote": string, "expectedFact": string, "sourceEvidence": string, "fixIntent": string}], "exitStateFacts": Fact[]}（Fact = {"key": string, "value": string|null, "sourceBlockId": string, "anchorQuote": string, "exitEvidence": {"exitAnchorQuote": string, "basis": "exit_confirmation"|"last_change", "supersededBy"?: string, "uncertain"?: boolean}}；exitStateFacts 的 value 必须是候选范围末尾仍成立的状态，exitEvidence.exitAnchorQuote 是证明该状态在末尾成立的候选片段，其位置由程序定位；只给旧字段 exitAnchorQuote 亦可受理，语义相同但无法表达依据类型与不确定性）',
  '约束：',
  '1) 只回报本轮要求未落实、必要事实丢失或明显改坏；不得提出「还能更好」的新风格愿望；',
  '2) 每条 issue 的 anchorQuote 必须能在候选正文中唯一命中，否则记入未定位而不进入自动补修；',
  '3) exitStateFacts 只报**候选范围末尾仍在成立**的当前状态：value 必填；exitEvidence.exitAnchorQuote 必须逐字出现在候选末尾、在候选中只出现一次、且 value 包含于其中；basis 说明依据是「范围末尾明确确认」还是「该状态在范围内的最后一次相关变化」；该锚点之后若还有同一状态的后续变化（如入场拿着、后面放下）必须填 supersededBy，程序不会把它当末态；重复引文、末尾对白、跨段持续状态等无法确认时填 uncertain:true，程序一律不作为确定状态；未知保持 null；无法给出末态证据锚点的一律不要上报；',
  '4) 没有问题则 issues 为空数组。',
].join('\n');

export const CHAPTER_REFINEMENT_REPAIR_SYSTEM_PROMPT = [
  '你是小说编辑，按给定的具体缺口对候选稿目标范围做定点替换。',
  '只输出替换后的目标范围正文纯文本，不输出方案、说明、标题、代码块或占位语。',
  '只修给定缺口，不重新规划本场，不添加新情节，不改变缺口之外的表达。',
  '替换后须仍与已接受前文及只读后文自然衔接，并保留交底中的必要事实与逐字锁。',
].join('\n');

// ── 输出合同类型 ──────────────────────────────────────────────────────

/**
 * B2：散场状态事实的**末态证据记录**。
 *
 * 与「引文命中」区分：命中只证明片段存在，末态成立还需要程序确认该片段位于范围末尾、
 * 且在它之后没有同一状态的后续变化。最小记录必须能表达：
 * - 证明末态成立的候选片段（`exitAnchorQuote`）；偏移一律由程序定位，不采信模型给出的数字；
 * - 依据类型（`basis`）：范围末尾的状态确认，还是该状态在范围内的最后一次相关变化；
 * - 锚点之后是否仍有后续相关变化（`supersededBy`）；
 * - 提取是否不确定（`uncertain`）：重复引文 / 末尾对话 / 跨段持续状态等歧义情形。
 *
 * 提取不确定、只有历史证据或存在后续变化时不进入确定状态集合。
 */
export interface RefinementStateEvidence {
  /** 证明该状态在范围末尾成立的候选片段；必须逐字出现在候选中且可唯一定位 */
  exitAnchorQuote: string;
  /** exit_confirmation：范围末尾明确确认；last_change：范围内最后一次相关变化 */
  basis: 'exit_confirmation' | 'last_change';
  /** 锚点之后仍存在的、与同一状态相关的后续变化片段 */
  supersededBy?: string;
  /** 提取不确定：重复引文、末尾对话、跨段持续状态等；true 时不进入确定集合 */
  uncertain?: boolean;
}

export type RefinementFact =
  | { key: string; value: null }
  | {
      key: string;
      value: string;
      sourceBlockId: string;
      anchorQuote: string;
      /**
       * W6：末态证据锚点（散场状态用）。
       *
       * 状态是「当前」散场状态，仅凭 quote/value 在候选全段子串命中不能证明它成立——
       * 「入场拿着钥匙」也会命中。这里要求事实额外给出**证明该状态在结尾成立的原文片段**，
       * 且状态值必须落在该片段内；缺失即视为无法确认，不得向下游传播。
       */
      exitAnchorQuote?: string;
      /**
       * B2：完整末态证据记录。存在时优先于扁平 `exitAnchorQuote`
       * （扁平字段保留为兼容形式，语义相同但无法表达依据类型与不确定性）。
       */
      exitEvidence?: RefinementStateEvidence;
    };

export interface RefinementSceneFragment {
  startBlockId: string;
  endBlockId: string;
  startsNewScene: boolean;
  confidence: 'high' | 'low';
  goal: string;
  entryFacts: RefinementFact[];
  exitFacts: RefinementFact[];
  proposedBeatEnds: Array<{ blockId: string; anchorQuote: string }>;
}

export interface RefinementInspectionIssue {
  sourceBlockId: string;
  anchorQuote: string;
  kind: 'goal_gap' | 'continuity' | 'expression_regression';
  why: string;
  editIntent: string;
}

export interface RefinementWindowInspection {
  windowId: string;
  sceneFragments: RefinementSceneFragment[];
  issues: RefinementInspectionIssue[];
}

export interface RefinementSceneBrief {
  sceneId: string;
  sourceBlockIds: string[];
  decision: 'keep' | 'patch' | 'rewrite';
  reason: string;
  editIntent: string;
  expectedChange: string;
  entryFacts: RefinementFact[];
  exitFacts: RefinementFact[];
  /** 程序从已验证诊断继承的中途事实；不属于整场首尾，模型输出不采信此字段。 */
  processFacts?: RefinementFact[];
  protectedSpanIds: string[];
  targetLength: {
    direction: 'hold' | 'expand' | 'condense';
    minChars?: number;
    maxChars?: number;
  };
  checks: Array<{ targetBlockId: string; expectedFact: string }>;
}

export interface RefinementBrief {
  chapterIntent: string;
  protectedFacts: RefinementFact[];
  sceneBriefs: RefinementSceneBrief[];
}

export interface RefinementPlanOutput {
  brief?: RefinementBrief;
  boundaryConflict?: { reason: string; detail: string };
}

export interface RefinementReviewIssue {
  kind: 'hard_constraint' | 'continuity' | 'style' | 'coverage';
  severity: 'high' | 'medium' | 'low';
  anchorQuote: string;
  expectedFact: string;
  sourceEvidence: string;
  fixIntent: string;
}

export interface RefinementReviewResult {
  issues: RefinementReviewIssue[];
  exitStateFacts: RefinementFact[];
}

export class RefinementModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefinementModelOutputError';
  }
}

// ── JSON 解析与校验 ───────────────────────────────────────────────────

/** 模型常带 ```json 围栏或前后说明；只取第一个平衡的 JSON 对象。 */
export function extractJsonObject(raw: string): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return null;
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseFact(raw: unknown): RefinementFact {
  const record = asRecord(raw);
  if (!record) {
    throw new RefinementModelOutputError('Fact 必须是对象');
  }
  const key = asString(record.key).trim();
  if (!key) {
    throw new RefinementModelOutputError('Fact.key 不能为空');
  }
  if (record.value === null || record.value === undefined) {
    return { key, value: null };
  }
  if (typeof record.value !== 'string') {
    throw new RefinementModelOutputError('Fact.value 必须是字符串或 null');
  }
  const sourceBlockId = asString(record.sourceBlockId).trim();
  const anchorQuote = asString(record.anchorQuote);
  if (!sourceBlockId || !anchorQuote) {
    throw new RefinementModelOutputError('有值 Fact 必须带 sourceBlockId 与 anchorQuote');
  }
  const exitAnchorQuote = asString(record.exitAnchorQuote).trim();
  const exitEvidence =
    parseStateEvidence(record.exitEvidence) ??
    (exitAnchorQuote ? { exitAnchorQuote, basis: 'exit_confirmation' as const } : null);
  return {
    key,
    value: record.value,
    sourceBlockId,
    anchorQuote,
    ...(exitAnchorQuote ? { exitAnchorQuote } : {}),
    ...(exitEvidence ? { exitEvidence } : {}),
  };
}

/**
 * B2：解析末态证据记录。
 *
 * 允许模型直接给扁平字符串（旧形式）或完整对象；`basis` 缺省按 `exit_confirmation`，
 * `uncertain` 缺省 false。非法 `basis` 视为不确定而不是丢弃整条证据记录——
 * 丢弃会让程序退回「只按锚点命中」的旧口径，比保守标记更危险。
 */
function parseStateEvidence(raw: unknown): RefinementStateEvidence | null {
  if (typeof raw === 'string') {
    const quote = raw.trim();
    return quote ? { exitAnchorQuote: quote, basis: 'exit_confirmation' } : null;
  }
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const exitAnchorQuote = asString(record.exitAnchorQuote).trim();
  if (!exitAnchorQuote) {
    return null;
  }
  const rawBasis = asString(record.basis).trim();
  const basis: RefinementStateEvidence['basis'] =
    rawBasis === 'last_change' || rawBasis === 'exit_confirmation' ? rawBasis : 'exit_confirmation';
  const supersededBy = asString(record.supersededBy).trim();
  const uncertainRaw = record.uncertain;
  return {
    exitAnchorQuote,
    basis,
    ...(supersededBy ? { supersededBy } : {}),
    ...(uncertainRaw === true || rawBasis === 'uncertain'
      ? { uncertain: true }
      : uncertainRaw === false
        ? { uncertain: false }
        : {}),
  };
}

/** B2：取出事实的末态证据记录（完整记录优先，退回扁平锚点）。 */
export function resolveStateEvidence(fact: RefinementFact): RefinementStateEvidence | null {
  if (fact.value === null) {
    return null;
  }
  if (fact.exitEvidence?.exitAnchorQuote) {
    return fact.exitEvidence;
  }
  const flat = fact.exitAnchorQuote?.trim();
  return flat ? { exitAnchorQuote: flat, basis: 'exit_confirmation' } : null;
}

function parseFactList(raw: unknown): RefinementFact[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(parseFact);
}

export function parseWindowInspection(
  raw: string,
  evidence?: {
    blocks: RefinementSourceBlock[];
    startBlockIndex: number;
    endBlockIndex: number;
    targetText: string;
    recoveries?: RefinementPlanBackfillRecord[];
  }
): RefinementWindowInspection {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new RefinementModelOutputError('inspect 输出未包含 JSON 对象');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RefinementModelOutputError('inspect 输出 JSON 解析失败');
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new RefinementModelOutputError('inspect 输出必须是对象');
  }
  const windowId = asString(record.windowId).trim();
  if (!windowId) {
    throw new RefinementModelOutputError('inspect 缺少 windowId');
  }
  const fragmentsRaw = Array.isArray(record.sceneFragments) ? record.sceneFragments : [];
  const sceneFragments: RefinementSceneFragment[] = fragmentsRaw.map((item) => {
    const frag = asRecord(item);
    if (!frag) {
      throw new RefinementModelOutputError('sceneFragments 项必须是对象');
    }
    const startBlockId = asString(frag.startBlockId).trim();
    const endBlockId = asString(frag.endBlockId).trim();
    if (!startBlockId || !endBlockId) {
      throw new RefinementModelOutputError('场景片段缺少 startBlockId / endBlockId');
    }
    const beatRaw = Array.isArray(frag.proposedBeatEnds) ? frag.proposedBeatEnds : [];
    return {
      startBlockId,
      endBlockId,
      startsNewScene: frag.startsNewScene === true,
      confidence: frag.confidence === 'low' ? 'low' : 'high',
      goal: asString(frag.goal),
      entryFacts: parseFactList(frag.entryFacts),
      exitFacts: parseFactList(frag.exitFacts),
      proposedBeatEnds: beatRaw.map((beat) => {
        const b = asRecord(beat) ?? {};
        return { blockId: asString(b.blockId).trim(), anchorQuote: asString(b.anchorQuote) };
      }),
    };
  });

  const issuesRaw = Array.isArray(record.issues) ? record.issues : [];
  const issues: RefinementInspectionIssue[] = issuesRaw.map((item) => {
    const issue = asRecord(item);
    if (!issue) {
      throw new RefinementModelOutputError('issues 项必须是对象');
    }
    const kind = asString(issue.kind);
    if (kind !== 'goal_gap' && kind !== 'continuity' && kind !== 'expression_regression') {
      throw new RefinementModelOutputError(`inspect issue.kind 非法: ${kind}`);
    }
    return {
      sourceBlockId: asString(issue.sourceBlockId).trim(),
      anchorQuote: asString(issue.anchorQuote),
      kind,
      why: asString(issue.why),
      editIntent: asString(issue.editIntent),
    };
  });

  if (evidence) {
    const blockById = new Map(evidence.blocks.map((block) => [block.id, block]));
    const allowedBlockIds = new Set(
      evidence.blocks
        .slice(evidence.startBlockIndex, evidence.endBlockIndex)
        .map((block) => block.id)
    );
    const violations: RefinementPlanViolation[] = [];
    for (const [i, fragment] of sceneFragments.entries()) {
      for (const field of ['entryFacts', 'exitFacts'] as const) {
        const facts = fragment[field];
        const path = `sceneFragments[${i}].${field}`;
        reanchorFactList(
          facts,
          path,
          allowedBlockIds,
          evidence.blocks,
          blockById,
          evidence.recoveries ?? []
        );
        verifyFactList(facts, path, null, blockById, violations, allowedBlockIds);
        for (const fact of facts) {
          if (
            fact.value !== null &&
            (!fact.anchorQuote || !containsQuoteEvidence(evidence.targetText, fact.anchorQuote))
          ) {
            violations.push({
              kind: 'quote_not_found',
              path,
              sceneId: null,
              message: `诊断事实「${fact.key}」无当前诊断目标内的引文证据，不得引用只读邻文`,
            });
          }
        }
      }
    }
    if (violations.length > 0) {
      throw new RefinementModelOutputError(
        violations.map((item) => `${item.path}：${item.message}`).join('；')
      );
    }
  }
  return { windowId, sceneFragments, issues };
}

export function parsePlanOutput(raw: string): RefinementPlanOutput {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new RefinementModelOutputError('plan 输出未包含 JSON 对象');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RefinementModelOutputError('plan 输出 JSON 解析失败');
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new RefinementModelOutputError('plan 输出必须是对象');
  }

  const conflict = asRecord(record.boundaryConflict);
  if (conflict) {
    return {
      boundaryConflict: {
        reason: asString(conflict.reason).trim() || 'boundary_conflict',
        detail: asString(conflict.detail),
      },
    };
  }

  const sceneBriefsRaw = Array.isArray(record.sceneBriefs) ? record.sceneBriefs : null;
  if (!sceneBriefsRaw || sceneBriefsRaw.length === 0) {
    throw new RefinementModelOutputError('plan 缺少 sceneBriefs');
  }
  const sceneBriefs: RefinementSceneBrief[] = sceneBriefsRaw.map((item) => {
    const brief = asRecord(item);
    if (!brief) {
      throw new RefinementModelOutputError('sceneBriefs 项必须是对象');
    }
    const sceneId = asString(brief.sceneId).trim();
    if (!sceneId) {
      throw new RefinementModelOutputError('sceneBrief 缺少 sceneId');
    }
    const decision = asString(brief.decision);
    if (decision !== 'keep' && decision !== 'patch' && decision !== 'rewrite') {
      throw new RefinementModelOutputError(`sceneBrief.decision 非法: ${decision}`);
    }
    const sourceBlockIds = Array.isArray(brief.sourceBlockIds)
      ? brief.sourceBlockIds.map((v) => asString(v).trim()).filter(Boolean)
      : [];
    if (sourceBlockIds.length === 0) {
      throw new RefinementModelOutputError(`场景 ${sceneId} 未覆盖任何 source block`);
    }
    const lengthRaw = asRecord(brief.targetLength) ?? {};
    const direction = asString(lengthRaw.direction);
    const targetLength: RefinementSceneBrief['targetLength'] = {
      direction: direction === 'expand' || direction === 'condense' ? direction : 'hold',
    };
    if (typeof lengthRaw.minChars === 'number') {
      targetLength.minChars = lengthRaw.minChars;
    }
    if (typeof lengthRaw.maxChars === 'number') {
      targetLength.maxChars = lengthRaw.maxChars;
    }
    const checksRaw = Array.isArray(brief.checks) ? brief.checks : [];
    return {
      sceneId,
      sourceBlockIds,
      decision,
      reason: asString(brief.reason),
      editIntent: asString(brief.editIntent),
      expectedChange: asString(brief.expectedChange),
      entryFacts: parseFactList(brief.entryFacts),
      exitFacts: parseFactList(brief.exitFacts),
      protectedSpanIds: Array.isArray(brief.protectedSpanIds)
        ? brief.protectedSpanIds.map((v) => asString(v).trim()).filter(Boolean)
        : [],
      targetLength,
      checks: checksRaw.map((c) => {
        const item = asRecord(c) ?? {};
        return {
          targetBlockId: asString(item.targetBlockId).trim(),
          expectedFact: asString(item.expectedFact),
        };
      }),
    };
  });

  return {
    brief: {
      chapterIntent: asString(record.chapterIntent),
      protectedFacts: parseFactList(record.protectedFacts),
      sceneBriefs,
    },
  };
}

// ── plan 合同恢复（AQ-383，设计见 plan-contract-recovery.md） ──────────

export type RefinementPlanViolationKind =
  | 'schema'
  | 'missing_fact_source'
  | 'ambiguous_backfill'
  | 'unknown_block_id'
  | 'quote_not_found'
  /** F2：把已验证的必要事实降级为 null（unknown） */
  | 'fact_downgraded'
  /** F2：遗漏已验证的必要事实（身份或范围不符） */
  | 'fact_dropped'
  /** F2：场景内事实的证据 block 不属于本场景允许范围（跨场取证） */
  | 'fact_out_of_scope';

export interface RefinementPlanViolation {
  kind: RefinementPlanViolationKind;
  /** 精确错误路径，如 `sceneBriefs[1].entryFacts[0]` */
  path: string;
  /** 归属场景；全章级为 null */
  sceneId: string | null;
  message: string;
}

export interface RefinementPlanBackfillRecord {
  path: string;
  key: string;
  value: string;
  sourceIndexKey: string;
  sourceBlockId: string;
  /** 来源回填 / 唯一重锚 / 边界继承 / 已验证过程归位，均记录确定性恢复依据。 */
  method: 'inspect_index' | 'quote_unique_block' | 'inspect_boundary' | 'inspect_process';
}

/** 已验证 inspect 事实的只读索引项：来源、引文与场景作用域均须通过原文验证。 */
export interface RefinementFactIndexEntry {
  key: string;
  value: string;
  sourceBlockId: string;
  anchorQuote: string;
  sceneId: string;
  startBlockIndex: number;
  endBlockIndex: number;
  role: 'entry' | 'exit' | 'process';
}

export function buildRefinementFactIndex(input: {
  scenes: RefinementMergedScene[];
  blocks: RefinementSourceBlock[];
  violations?: RefinementPlanViolation[];
  backfilled?: RefinementPlanBackfillRecord[];
}): RefinementFactIndexEntry[] {
  const entries: RefinementFactIndexEntry[] = [];
  const violations = input.violations ?? [];
  const blockById = new Map(input.blocks.map((block) => [block.id, block]));
  for (const scene of input.scenes) {
    const allowedBlockIds = new Set(
      input.blocks.slice(scene.startBlockIndex, scene.endBlockIndex).map((block) => block.id)
    );
    for (const [fragmentIndex, fragment] of scene.fragments.entries()) {
      for (const [factIndex, source] of [...fragment.entryFacts, ...fragment.exitFacts].entries()) {
        if (source.value === null) {
          continue;
        }
        const fact = { ...source };
        const path = `inspect[${scene.sceneId}].fragments[${fragmentIndex}].facts[${factIndex}]`;
        if (!fact.sourceBlockId || !fact.anchorQuote) {
          violations.push({
            kind: 'missing_fact_source',
            path,
            sceneId: scene.sceneId,
            message: `诊断事实「${fact.key}」缺少原文来源`,
          });
          continue;
        }
        const previousCount = violations.length;
        reanchorFactList(
          [fact],
          path,
          allowedBlockIds,
          input.blocks,
          blockById,
          input.backfilled ?? []
        );
        verifyFactList([fact], path, scene.sceneId, blockById, violations, allowedBlockIds);
        if (violations.length !== previousCount) {
          continue;
        }
        entries.push({
          key: fact.key,
          value: fact.value,
          sourceBlockId: fact.sourceBlockId,
          anchorQuote: fact.anchorQuote,
          sceneId: scene.sceneId,
          startBlockIndex: scene.startBlockIndex,
          endBlockIndex: scene.endBlockIndex,
          role:
            factIndex < fragment.entryFacts.length
              ? fragmentIndex === 0
                ? 'entry'
                : 'process'
              : fragmentIndex === scene.fragments.length - 1
                ? 'exit'
                : 'process',
        });
      }
    }
  }
  if (!input.violations && violations.length > 0) {
    throw new RefinementModelOutputError(violations.map((item) => item.message).join('；'));
  }
  return entries;
}

export interface RefinementPlanRecovery {
  brief: RefinementBrief | null;
  boundaryConflict?: { reason: string; detail: string };
  violations: RefinementPlanViolation[];
  backfilled: RefinementPlanBackfillRecord[];
}

/**
 * plan 合同恢复入口：确定性证据回填 → 严格合同解析 → ID 与引文验证。
 * 不抛异常，把结构／字段／引用问题统一转成可记录的违规路径。
 *
 * 回填只补缺失来源字段（key+value 在已验证索引中唯一匹配），不覆盖已有字段；
 * 同值多来源、索引无匹配、已有错误引文一律记为违规交给上层重试或暂停。
 */
export function parsePlanOutputWithRecovery(input: {
  raw: string;
  blocks: RefinementSourceBlock[];
  scenes: RefinementMergedScene[];
}): RefinementPlanRecovery {
  const backfilled: RefinementPlanBackfillRecord[] = [];
  const violations: RefinementPlanViolation[] = [];

  const json = extractJsonObject(input.raw);
  if (!json) {
    return schemaFailure('plan 输出未包含 JSON 对象', backfilled);
  }
  let record: Record<string, unknown> | null;
  try {
    record = asRecord(JSON.parse(json));
  } catch {
    return schemaFailure('plan 输出 JSON 解析失败', backfilled);
  }
  if (!record) {
    return schemaFailure('plan 输出必须是对象', backfilled);
  }

  const index = buildRefinementFactIndex({ ...input, violations, backfilled });
  if (violations.length > 0) {
    return { brief: null, violations, backfilled };
  }
  // F2：全章保护事实允许全文范围；场景内事实限定在自己的 sourceBlockIds 内，
  // 不允许因 key/value 相同就从其它场景复制证据（跨场取证）。
  backfillFactList(
    record.protectedFacts,
    'protectedFacts',
    null,
    index,
    backfilled,
    violations,
    null
  );
  const sceneBriefsRaw = Array.isArray(record.sceneBriefs) ? record.sceneBriefs : [];
  sceneBriefsRaw.forEach((item, i) => {
    const brief = asRecord(item);
    if (!brief) {
      return;
    }
    const sceneId = asString(brief.sceneId).trim() || null;
    const allowedBlockIds = new Set(
      (Array.isArray(brief.sourceBlockIds) ? brief.sourceBlockIds : [])
        .map((id) => asString(id).trim())
        .filter(Boolean)
    );
    for (const [field, role] of [
      ['entryFacts', 'entry'],
      ['exitFacts', 'exit'],
    ] as const) {
      const facts = brief[field];
      if (!Array.isArray(facts)) {
        continue;
      }
      // 完整匹配已验证中途证据时，仅归还事实角色；错误值、null、错误引文不覆盖。
      // 若同一证据也确实属于该边界，仍保留边界角色。
      for (let j = facts.length - 1; j >= 0; j -= 1) {
        const fact = asRecord(facts[j]);
        if (!fact) continue;
        const matches = index.filter(
          (entry) =>
            allowedBlockIds.has(entry.sourceBlockId) &&
            entry.key === fact.key &&
            entry.value === fact.value &&
            entry.sourceBlockId === fact.sourceBlockId &&
            entry.anchorQuote === fact.anchorQuote
        );
        const process = matches.find((entry) => entry.role === 'process');
        if (!process || matches.some((entry) => entry.role === role)) continue;
        facts.splice(j, 1);
        backfilled.push({
          path: `sceneBriefs[${i}].${field}[${j}]`,
          key: process.key,
          value: process.value,
          sourceBlockId: process.sourceBlockId,
          sourceIndexKey: `${process.sceneId}#process#${process.key}`,
          method: 'inspect_process',
        });
      }
      const candidates = index.filter(
        (entry) => entry.role === role && allowedBlockIds.has(entry.sourceBlockId)
      );
      const byKey = new Map<string, RefinementFactIndexEntry[]>();
      for (const entry of candidates) {
        const group = byKey.get(entry.key) ?? [];
        if (
          !group.some(
            (item) =>
              item.value === entry.value &&
              item.sourceBlockId === entry.sourceBlockId &&
              item.anchorQuote === entry.anchorQuote
          )
        ) {
          group.push(entry);
        }
        byKey.set(entry.key, group);
      }
      for (const [key, group] of byKey) {
        // 已声明同 key（包括错误值 / null）不覆盖；多来源不猜测。
        if (
          group.length !== 1 ||
          facts.some((item) => asString(asRecord(item)?.key).trim() === key)
        ) {
          continue;
        }
        const { value, sourceBlockId, anchorQuote } = group[0];
        facts.push({ key, value, sourceBlockId, anchorQuote });
        backfilled.push({
          path: `sceneBriefs[${i}].${field}[${facts.length - 1}]`,
          key,
          value,
          sourceBlockId,
          sourceIndexKey: `${group[0].sceneId}#${role}#${key}`,
          method: 'inspect_boundary',
        });
      }
    }
    backfillFactList(
      brief.entryFacts,
      `sceneBriefs[${i}].entryFacts`,
      sceneId,
      index,
      backfilled,
      violations,
      allowedBlockIds
    );
    backfillFactList(
      brief.exitFacts,
      `sceneBriefs[${i}].exitFacts`,
      sceneId,
      index,
      backfilled,
      violations,
      allowedBlockIds
    );
  });

  let parsed: RefinementPlanOutput;
  try {
    parsed = parsePlanOutput(JSON.stringify(record));
  } catch (error) {
    // 缺来源字段的违规已单独记录；其余结构问题补一条 schema 路径
    if (violations.length === 0) {
      violations.push({
        kind: 'schema',
        path: '$',
        sceneId: null,
        message: error instanceof Error ? error.message : 'plan 输出解析失败',
      });
    }
    return { brief: null, violations, backfilled };
  }
  if (parsed.boundaryConflict) {
    return { brief: null, boundaryConflict: parsed.boundaryConflict, violations, backfilled };
  }
  if (!parsed.brief || parsed.brief.sceneBriefs.length === 0) {
    violations.push({
      kind: 'schema',
      path: 'sceneBriefs',
      sceneId: null,
      message: 'plan 缺少场景交底',
    });
    return { brief: null, violations, backfilled };
  }

  const blockById = new Map(input.blocks.map((block) => [block.id, block]));
  reanchorFactList(
    parsed.brief.protectedFacts,
    'protectedFacts',
    null,
    input.blocks,
    blockById,
    backfilled
  );
  verifyFactList(parsed.brief.protectedFacts, 'protectedFacts', null, blockById, violations);
  parsed.brief.sceneBriefs.forEach((sceneBrief, i) => {
    const allowedBlockIds = new Set(sceneBrief.sourceBlockIds);
    const owner =
      input.scenes.find((scene) => scene.sceneId === sceneBrief.sceneId) ??
      input.scenes.find((scene) =>
        input.blocks
          .slice(scene.startBlockIndex, scene.endBlockIndex)
          .some((block) => allowedBlockIds.has(block.id))
      );
    sceneBrief.processFacts = index
      .filter(
        (entry) =>
          entry.role === 'process' &&
          entry.sceneId === owner?.sceneId &&
          allowedBlockIds.has(entry.sourceBlockId)
      )
      .map(({ key, value, sourceBlockId, anchorQuote }) => ({
        key,
        value,
        sourceBlockId,
        anchorQuote,
      }));
    sceneBrief.sourceBlockIds.forEach((id, j) => {
      if (!blockById.has(id)) {
        violations.push({
          kind: 'unknown_block_id',
          path: `sceneBriefs[${i}].sourceBlockIds[${j}]`,
          sceneId: sceneBrief.sceneId,
          message: `sourceBlockId 不存在：${id}`,
        });
      }
    });
    sceneBrief.protectedSpanIds.forEach((id, j) => {
      if (!blockById.has(id)) {
        violations.push({
          kind: 'unknown_block_id',
          path: `sceneBriefs[${i}].protectedSpanIds[${j}]`,
          sceneId: sceneBrief.sceneId,
          message: `protectedSpanId 不存在：${id}`,
        });
      }
    });
    sceneBrief.checks.forEach((check, j) => {
      if (check.targetBlockId && !blockById.has(check.targetBlockId)) {
        violations.push({
          kind: 'unknown_block_id',
          path: `sceneBriefs[${i}].checks[${j}].targetBlockId`,
          sceneId: sceneBrief.sceneId,
          message: `targetBlockId 不存在：${check.targetBlockId}`,
        });
      }
    });
    reanchorFactList(
      sceneBrief.entryFacts,
      `sceneBriefs[${i}].entryFacts`,
      new Set(sceneBrief.sourceBlockIds),
      input.blocks,
      blockById,
      backfilled
    );
    reanchorFactList(
      sceneBrief.exitFacts,
      `sceneBriefs[${i}].exitFacts`,
      new Set(sceneBrief.sourceBlockIds),
      input.blocks,
      blockById,
      backfilled
    );
    verifyFactList(
      sceneBrief.entryFacts,
      `sceneBriefs[${i}].entryFacts`,
      sceneBrief.sceneId,
      blockById,
      violations,
      new Set(sceneBrief.sourceBlockIds)
    );
    verifyFactList(
      sceneBrief.exitFacts,
      `sceneBriefs[${i}].exitFacts`,
      sceneBrief.sceneId,
      blockById,
      violations,
      new Set(sceneBrief.sourceBlockIds)
    );
  });

  // F2：必要事实保留检查——不得把已验证事实降级为 unknown 或遗漏
  verifyNecessaryFactsPreserved({
    brief: parsed.brief,
    scenes: input.scenes,
    blocks: input.blocks,
    violations,
  });

  if (violations.length > 0) {
    // 保留可解析的 brief：上层据此判断能否按场景保守降级
    return { brief: parsed.brief, violations, backfilled };
  }
  return { brief: parsed.brief, violations: [], backfilled };
}

function schemaFailure(
  message: string,
  backfilled: RefinementPlanBackfillRecord[]
): RefinementPlanRecovery {
  return {
    brief: null,
    violations: [{ kind: 'schema', path: '$', sceneId: null, message }],
    backfilled,
  };
}

/**
 * F2：确定性证据回填——**只补缺失字段**，绝不覆盖已有字段。
 *
 *  - 两个来源字段都缺：按 key+value 在已验证索引中唯一匹配，补全两个字段（inspect_index）；
 *    同值多来源 / 无匹配一律记违规。
 *  - 只缺 sourceBlockId：已有 anchorQuote 必须能被唯一索引证据佐证，才补 sourceBlockId；
 *    引文无法佐证（可能是错误引文）记违规，交上层重试或暂停。
 *  - 只缺 anchorQuote：不得凭空编造引文，记违规。
 *  - 已有非法值一律进入唯一一次重试或暂停，不由回填静默覆盖。
 */
function backfillFactList(
  raw: unknown,
  path: string,
  sceneId: string | null,
  index: RefinementFactIndexEntry[],
  backfilled: RefinementPlanBackfillRecord[],
  violations: RefinementPlanViolation[],
  /**
   * F2：允许的证据读取范围。场景内事实限定在其 sourceBlockIds；
   * 全章保护事实传 null（允许全文范围）。回填与佐证都先按此范围过滤，
   * 不允许因 key/value 相同就从其它场景复制证据。
   */
  allowedBlockIds: Set<string> | null = null
): void {
  if (!Array.isArray(raw)) {
    return;
  }
  const scopedIndex =
    allowedBlockIds === null
      ? index
      : index.filter((entry) => allowedBlockIds.has(entry.sourceBlockId));
  raw.forEach((item, i) => {
    const fact = asRecord(item);
    if (!fact) {
      return;
    }
    const key = asString(fact.key).trim();
    const value = typeof fact.value === 'string' ? fact.value : null;
    // 无值 Fact / 缺 key 不参与回填（降级为 null / 漏 key 由必要事实保留检查负责）
    if (!key || value === null) {
      return;
    }
    const sourceBlockId = asString(fact.sourceBlockId).trim();
    const anchorQuote = asString(fact.anchorQuote).trim();
    if (sourceBlockId && anchorQuote) {
      return;
    }
    const matches = scopedIndex.filter((entry) => entry.key === key && entry.value === value);

    if (!sourceBlockId && !anchorQuote) {
      if (matches.length === 1) {
        fact.sourceBlockId = matches[0].sourceBlockId;
        fact.anchorQuote = matches[0].anchorQuote;
        backfilled.push({
          path: `${path}[${i}]`,
          key,
          value,
          sourceIndexKey: `${matches[0].sceneId}#${key}`,
          sourceBlockId: matches[0].sourceBlockId,
          method: 'inspect_index',
        });
        return;
      }
      violations.push({
        kind: matches.length === 0 ? 'missing_fact_source' : 'ambiguous_backfill',
        path: `${path}[${i}]`,
        sceneId,
        message:
          matches.length === 0
            ? `有值 Fact「${key}」缺来源字段，且已验证索引中无匹配证据`
            : `有值 Fact「${key}」在已验证索引中有多个同值来源，不可猜测`,
      });
      return;
    }

    if (!sourceBlockId && anchorQuote) {
      // 只缺 sourceBlockId：已有引文必须被唯一索引证据佐证，否则视为错误引文
      const corroborated = matches.filter(
        (entry) =>
          entry.anchorQuote === anchorQuote ||
          entry.anchorQuote.includes(anchorQuote) ||
          anchorQuote.includes(entry.anchorQuote)
      );
      if (corroborated.length === 1) {
        fact.sourceBlockId = corroborated[0].sourceBlockId;
        backfilled.push({
          path: `${path}[${i}]`,
          key,
          value,
          sourceIndexKey: `quote#${corroborated[0].sourceBlockId}`,
          sourceBlockId: corroborated[0].sourceBlockId,
          method: 'quote_unique_block',
        });
        return;
      }
      violations.push({
        kind: 'missing_fact_source',
        path: `${path}[${i}].sourceBlockId`,
        sceneId,
        message:
          corroborated.length === 0
            ? `有值 Fact「${key}」缺 sourceBlockId，且已有引文无法由唯一索引证据佐证（疑似错误引文）`
            : `有值 Fact「${key}」缺 sourceBlockId，已有引文在索引中有多个候选，不可猜测`,
      });
      return;
    }

    // 只缺 anchorQuote：不得凭空编造，交重试补全
    violations.push({
      kind: 'missing_fact_source',
      path: `${path}[${i}].anchorQuote`,
      sceneId,
      message: `有值 Fact「${key}」缺 anchorQuote，不得凭空编造引文`,
    });
  });
}

/**
 * F2：必要事实保留检查。
 *
 * 已验证（inspect 给出有值且有来源）的必要事实不能被 plan 降级为 unknown 或遗漏：
 *  - 同一场景、同一边界角色的 key 在 plan 中输出 `value=null` → `fact_downgraded`；
 *    另一边界的同名 unknown 不表示此时点的已知状态被降级；
 *  - 已验证事实在全章 protectedFacts 或所属场景的对应首尾角色都不再出现 →
 *    `fact_dropped`。
 */
function verifyNecessaryFactsPreserved(input: {
  brief: RefinementBrief;
  scenes: RefinementMergedScene[];
  blocks: RefinementSourceBlock[];
  violations: RefinementPlanViolation[];
}): void {
  const index = buildRefinementFactIndex(input).filter((entry) => entry.role !== 'process');
  if (index.length === 0) {
    return;
  }
  const sceneIdByBlockId = new Map<string, string>();
  for (const scene of input.scenes) {
    for (let i = scene.startBlockIndex; i < scene.endBlockIndex; i += 1) {
      sceneIdByBlockId.set(input.blocks[i].id, scene.sceneId);
    }
  }

  const globalFacts = input.brief.protectedFacts;
  const sceneFacts = new Map<string, { entry: RefinementFact[]; exit: RefinementFact[] }>();
  for (const brief of input.brief.sceneBriefs) {
    const sceneId =
      brief.sceneId && input.scenes.some((scene) => scene.sceneId === brief.sceneId)
        ? brief.sceneId
        : (brief.sourceBlockIds
            .map((blockId) => sceneIdByBlockId.get(blockId))
            .find((id): id is string => Boolean(id)) ?? brief.sceneId);
    const existing = sceneFacts.get(sceneId);
    sceneFacts.set(sceneId, {
      entry: [...(existing?.entry ?? []), ...brief.entryFacts],
      exit: [...(existing?.exit ?? []), ...brief.exitFacts],
    });
  }

  const hasValue = (facts: readonly RefinementFact[], key: string, value: string): boolean =>
    facts.some((fact) => fact.key === key && fact.value === value);

  // 降级检查：全章 + 各场
  const nullKeysGlobal = new Set(
    globalFacts.filter((fact) => fact.value === null).map((fact) => fact.key)
  );
  for (const entry of index) {
    if (nullKeysGlobal.has(entry.key)) {
      input.violations.push({
        kind: 'fact_downgraded',
        path: `protectedFacts[${entry.key}]`,
        sceneId: null,
        message: `已验证必要事实「${entry.key}=${entry.value}」不得降级为 unknown（value=null）`,
      });
    }
  }
  // 场景边界按角色校验，避免「入场未知 / 散场已知」同名 key 互相污染。
  for (const entry of index) {
    const role = entry.role === 'entry' ? 'entry' : 'exit';
    const facts = sceneFacts.get(entry.sceneId)?.[role] ?? [];
    const path = `sceneBriefs[${entry.sceneId}].${role}Facts[${entry.key}]`;
    if (facts.some((fact) => fact.key === entry.key && fact.value === null)) {
      input.violations.push({
        kind: 'fact_downgraded',
        path,
        sceneId: entry.sceneId,
        message: `场景 ${entry.sceneId} 的${role === 'entry' ? '入场' : '散场'}已验证必要事实「${entry.key}=${entry.value}」不得降级为 unknown`,
      });
    }
    // 已验证事实必须在全章或所属场景的对应边界中以原值保留。
    const preservedGlobally = hasValue(globalFacts, entry.key, entry.value);
    const preservedInScene = hasValue(facts, entry.key, entry.value);
    if (!preservedGlobally && !preservedInScene) {
      input.violations.push({
        kind: 'fact_dropped',
        path,
        sceneId: entry.sceneId,
        message: `已验证必要事实「${entry.key}=${entry.value}」在 plan 中被遗漏（身份或作用域不符）`,
      });
    }
  }
}

/**
 * 引文唯一重锚（AQ-383 补充，见 plan-contract-recovery.md §3）。
 *
 * 上游 inspect 与 plan 常把事实归到相邻 block：例如把信件正文归到「昭儿：」那一行，
 * 逐字引文正确但 sourceBlockId 错位，会让整章在 plan 校验处暂停。当声明 block 内找不到
 * 引文、而该引文在允许范围内**唯一一个** block 中逐字出现时，把 sourceBlockId 重锚到该
 * block 并记录来源；命中 0 个或多个候选一律不动，保留违规交给重试或暂停。
 *
 * 场景内事实限定在该场 sourceBlockIds 内，全章 protectedFacts 允许全文范围。
 */
function reanchorFactList(
  facts: RefinementFact[],
  path: string,
  allowedBlockIds: Set<string> | null,
  blocks: RefinementSourceBlock[],
  blockById: Map<string, RefinementSourceBlock>,
  backfilled: RefinementPlanBackfillRecord[]
): void {
  facts.forEach((fact, i) => {
    if (fact.value === null || !fact.anchorQuote) {
      return;
    }
    const declared = blockById.get(fact.sourceBlockId);
    if (
      declared &&
      (!allowedBlockIds || allowedBlockIds.has(declared.id)) &&
      containsQuoteEvidence(declared.text, fact.anchorQuote)
    ) {
      return;
    }
    const owners = blocks.filter(
      (block) =>
        (!allowedBlockIds || allowedBlockIds.has(block.id)) &&
        containsQuoteEvidence(block.text, fact.anchorQuote)
    );
    if (owners.length !== 1 || owners[0].id === fact.sourceBlockId) {
      return;
    }
    fact.sourceBlockId = owners[0].id;
    backfilled.push({
      path: `${path}[${i}]`,
      key: fact.key,
      value: fact.value,
      sourceIndexKey: `quote#${owners[0].id}`,
      sourceBlockId: owners[0].id,
      method: 'quote_unique_block',
    });
  });
}

/**
 * 引文证据匹配（AQ-383）：模型常把原文的直引号转写成中文弯引号，或在连续引语句末补一个
 * 原文没有的闭引号；严格 `includes` 会把这类同义证据误判为「引文未命中」。这里做引号字形
 * 无关的包含判断：先精确匹配，再忽略引号字形匹配（内容字符仍须连续出现）。引文去除引号后
 * 无内容字符时退回精确匹配，避免空串命中。
 *
 * 对话归一化（2026-10-07 补充）：小说对白常写成 `"甲。"他说，"乙。"`，模型引用「说的话」时
 * 会丢掉中间的说话人提示。当引文在 block 中不能连续命中、但等于该 block 内引号文本按顺序
 * 拼接后的内容时，判为命中。仍要求内容字符精确一致，不做语义或距离近似。
 */
const QUOTE_GLYPH_PATTERN =
  /[\u0022\u0027\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f\u300c\u300d\u300e\u300f\uff02\uff07]/g;

/** 提取 block 内各引号对的内容并按顺序拼接；无引号对返回空串。 */
function concatenatedQuotedContent(text: string): string {
  const spans: string[] = [];
  const pattern = /"([^"]*)"|“([^”]*)”|「([^」]*)」|『([^』]*)』/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const inner = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
    if (inner) {
      spans.push(inner);
    }
  }
  return spans.join('');
}

export function containsQuoteEvidence(haystack: string, needle: string): boolean {
  if (!needle) {
    return false;
  }
  if (haystack.includes(needle)) {
    return true;
  }
  const bareNeedle = needle.replace(QUOTE_GLYPH_PATTERN, '');
  if (!bareNeedle) {
    return false;
  }
  if (haystack.replace(QUOTE_GLYPH_PATTERN, '').includes(bareNeedle)) {
    return true;
  }
  const dialogue = concatenatedQuotedContent(haystack).replace(QUOTE_GLYPH_PATTERN, '');
  return Boolean(dialogue) && dialogue.includes(bareNeedle);
}

/**
 * B2：把文本切成句段（证据定位用）。
 *
 * 末态证据的位置由程序按句段判定，而不是采信模型标注——模型把入场片段改名成
 * exitAnchorQuote 时，只有句段位置能区分「入场动作」与「末态确认」。
 * 切点包含句末标点与逗号、分号、换行（小说对白与短句常以逗号收束）。
 */
const SEGMENT_TERMINATORS = new Set(['。', '！', '？', '!', '?', '…', '；', ';', '，', ',', '\n']);

export interface RefinementEvidenceSegment {
  start: number;
  end: number;
  text: string;
}

export function splitRefinementEvidenceSegments(text: string): RefinementEvidenceSegment[] {
  const segments: RefinementEvidenceSegment[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!SEGMENT_TERMINATORS.has(text[i])) {
      continue;
    }
    segments.push({ start, end: i + 1, text: text.slice(start, i + 1) });
    start = i + 1;
  }
  if (start < text.length) {
    segments.push({ start, end: text.length, text: text.slice(start) });
  }
  return segments;
}

/** 归一化（去引号字形）并保留「归一化下标 → 原串下标」映射，供程序定位偏移。 */
function normalizeWithIndexMap(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (QUOTE_GLYPH_PATTERN.test(ch)) {
      continue;
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

export interface RefinementQuoteLocation {
  /** 命中片段在原文中的起始下标（含） */
  start: number;
  /** 命中片段在原文中的结束下标（不含） */
  end: number;
}

/**
 * B2：程序定位引文在正文中的**全部**出现位置（引号字形无关）。
 *
 * 偏移由程序计算，不接受模型给出的任何数字。未命中返回空数组；
 * 命中但依赖对白拼接等无法逐码元映射的归一化时同样返回空数组（位置不可唯一定位）。
 */
export function locateAllQuoteOccurrences(
  haystack: string,
  needle: string
): RefinementQuoteLocation[] {
  if (!haystack || !needle) {
    return [];
  }
  if (haystack.includes(needle)) {
    const found: RefinementQuoteLocation[] = [];
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      found.push({ start: at, end: at + needle.length });
      from = at + 1;
    }
    return found;
  }
  const source = normalizeWithIndexMap(haystack);
  const target = normalizeWithIndexMap(needle);
  if (!target.text) {
    return [];
  }
  const found: RefinementQuoteLocation[] = [];
  let from = 0;
  for (;;) {
    const at = source.text.indexOf(target.text, from);
    if (at < 0) {
      break;
    }
    const start = source.map[at];
    const last = source.map[at + target.text.length - 1];
    if (start === undefined || last === undefined) {
      break;
    }
    found.push({ start, end: last + 1 });
    from = at + 1;
  }
  return found;
}

const OPENING_QUOTES = new Set(['“', '"', '「', '『', '‘', "'"]);
const CLOSING_QUOTES = new Set(['”', '"', '」', '』', '’', "'"]);
/** `" / '` 既可开也可闭；按出现顺序与当前深度决定，不依赖字形唯一区分。 */
const AMBIGUOUS_QUOTES = new Set(['"', "'"]);

/**
 * B2：判断片段是否落在对白内部。
 *
 * 末尾对白中的状态陈述不等于叙述末态（人物「说」的内容与场景实际状态可以不同），
 * 程序按引号配对深度判定；引号不成对时按保守（深度不为 0）处理。
 */
export function isInsideDialogue(text: string, start: number, end: number): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (i === start) {
      if (depth > 0) {
        return true;
      }
    }
    if (i >= end) {
      break;
    }
    const ch = text[i];
    if (AMBIGUOUS_QUOTES.has(ch)) {
      depth = depth > 0 ? 0 : 1;
    } else if (OPENING_QUOTES.has(ch)) {
      depth += 1;
    } else if (CLOSING_QUOTES.has(ch)) {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0;
}

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_WORD = /[A-Za-z]{3,}/g;

/**
 * B2：两段文本是否共享内容词（CJK 二字组 / 长度≥3 的拉丁词）。
 *
 * 用于判断「末态锚点之后是否仍有同一状态的后续变化」：同物件再次被提起
 * （如入场拿钥匙、后面放下钥匙）即视为后续相关变化，不能把入场动作当末态确认。
 * 这是**程序可判定的相关性近似**，不是语义判断：人物行为是否真的改变状态仍依赖 review 与模型评测。
 */
export function sharesContentToken(a: string, b: string): boolean {
  const tokens = new Set<string>();
  for (const text of [a, b]) {
    const local = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) {
      if (CJK_CHAR.test(text[i]) && CJK_CHAR.test(text[i + 1])) {
        local.add(text.slice(i, i + 2));
      }
    }
    for (const match of text.matchAll(LATIN_WORD)) {
      local.add(match[0].toLowerCase());
    }
    if (tokens.size === 0) {
      for (const token of local) {
        tokens.add(token);
      }
    } else {
      const shared = [...local].filter((token) => tokens.has(token));
      if (shared.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * F5 / W6 / B2：散场状态事实的证据判定。
 *
 * 区分「引文命中」与「末态成立」：命中只证明片段存在；末态成立还须程序确认
 * 该片段可唯一定位、不在对白内，且其之后没有同一状态的后续变化。
 *
 * - `evidence`：末态锚点在候选内唯一命中、可定位、非对白、之后无后续相关变化 → 向下游传递；
 * - `superseded`：锚点命中，但之后仍有同一状态的后续变化（入场拿、后面放下）→ 不得当作末态；
 * - `ambiguous`：锚点重复出现 / 落在对白内 / 位置无法唯一定位 / 模型自标不确定 → 不进入确定集合；
 * - `historical`：末态锚点不在候选，只有改写前原文能命中 → 历史动作不能证明散场仍成立；
 * - `unknown`：`value=null`，源材料确实未知；
 * - `conflict`：候选、末态锚点与原文都无法命中（凭空状态），必须拒绝传播。
 */
export type RefinementStateFactStatus =
  | {
      status: 'evidence';
      origin: 'candidate';
      /** 程序定位到的末态锚点唯一位置（UTF-16 偏移，前闭后开） */
      start: number;
      end: number;
      basis: RefinementStateEvidence['basis'];
    }
  | { status: 'superseded'; reason: string }
  | { status: 'ambiguous'; reason: string }
  | { status: 'historical' }
  | { status: 'unknown' }
  | { status: 'conflict' };

export function verifyRefinementStateFact(
  fact: RefinementFact,
  input: { candidate: string; original: string }
): RefinementStateFactStatus {
  if (fact.value === null) {
    return { status: 'unknown' };
  }
  const quote = fact.anchorQuote.trim();
  const value = fact.value.trim();
  if (!quote || !value) {
    return { status: 'conflict' };
  }
  // W6/B2：必须给出末态证据锚点——只在候选任意位置命中不足以证明「散场仍成立」
  const evidence = resolveStateEvidence(fact);
  if (!evidence) {
    return matchesOriginalOnly(input, quote, value);
  }
  if (evidence.uncertain === true) {
    return { status: 'ambiguous', reason: '事实自标提取不确定，不进入确定状态集合' };
  }
  const anchor = evidence.exitAnchorQuote.trim();
  if (!containsQuoteEvidence(input.candidate, anchor)) {
    return matchesOriginalOnly(input, quote, value);
  }
  if (!containsQuoteEvidence(anchor, value)) {
    return { status: 'ambiguous', reason: '末态锚点不含状态值，无法确认末态成立' };
  }
  const occurrences = locateAllQuoteOccurrences(input.candidate, anchor);
  if (occurrences.length === 0) {
    // 命中依赖对白拼接等无法逐码元映射的归一化：位置不能由程序唯一确定
    return { status: 'ambiguous', reason: '末态锚点无法在候选中唯一定位' };
  }
  if (occurrences.length > 1) {
    return {
      status: 'ambiguous',
      reason: `末态锚点在候选中出现 ${occurrences.length} 次，无法确定末态位置`,
    };
  }
  const { start, end } = occurrences[0];
  if (isInsideDialogue(input.candidate, start, end)) {
    return { status: 'ambiguous', reason: '末态证据落在对白内，不等于叙述末态' };
  }
  // R2：后续相关变化的扫描从「锚点结束处」切出的尾部开始，而不是先从句段起点过滤。
  // 锚点位于句中时，它所在句的后半句同样在锚点之后，必须纳入扫描——
  // 旧写法只保留 segment.start >= end 的句段，会把同句剩余部分整体丢掉。
  const tail = input.candidate.slice(end);
  const laterRelated = splitRefinementEvidenceSegments(tail).filter((segment) =>
    sharesContentToken(segment.text, `${anchor}${value}`)
  );
  const declaredSupersede = evidence.supersededBy?.trim();
  if (declaredSupersede) {
    // 自报的后续变化必须由程序校验「出现在锚点之后」，否则先后关系无法确认
    const declaredLater = locateAllQuoteOccurrences(input.candidate, declaredSupersede).some(
      (occurrence) => occurrence.start >= end
    );
    if (declaredLater) {
      return {
        status: 'superseded',
        reason: '事实自报末态锚点之后仍有后续相关变化（位置已由程序校验）',
      };
    }
    if (containsQuoteEvidence(input.candidate, declaredSupersede)) {
      return {
        status: 'ambiguous',
        reason: '事实自报的后续变化未出现在末态锚点之后，先后关系无法由程序确认',
      };
    }
  }
  if (laterRelated.length > 0) {
    return {
      status: 'superseded',
      reason: `末态锚点之后仍有同一状态的后续变化：${laterRelated[0].text.trim().slice(0, 24)}`,
    };
  }
  return { status: 'evidence', origin: 'candidate', start, end, basis: evidence.basis };
}

/** 只有改写前原文能命中：原文已被候选替换，不能据此认定当前散场状态。 */
function matchesOriginalOnly(
  input: { candidate: string; original: string },
  quote: string,
  value: string
): RefinementStateFactStatus {
  if (
    containsQuoteEvidence(input.original, quote) &&
    containsQuoteEvidence(input.original, value)
  ) {
    return { status: 'historical' };
  }
  return { status: 'conflict' };
}

function verifyFactList(
  facts: RefinementFact[],
  path: string,
  sceneId: string | null,
  blockById: Map<string, RefinementSourceBlock>,
  violations: RefinementPlanViolation[],
  /** F2：场景内事实允许的证据范围；全章保护事实传 undefined（全文范围） */
  allowedBlockIds?: Set<string>
): void {
  const enforceScope = allowedBlockIds !== undefined && allowedBlockIds.size > 0;
  facts.forEach((fact, i) => {
    if (fact.value === null) {
      return;
    }
    const block = blockById.get(fact.sourceBlockId);
    if (!block) {
      violations.push({
        kind: 'unknown_block_id',
        path: `${path}[${i}].sourceBlockId`,
        sceneId,
        message: `Fact「${fact.key}」引用的 sourceBlockId 不存在：${fact.sourceBlockId}`,
      });
      return;
    }
    // F2：场景内事实的证据必须落在本场景允许的 sourceBlockIds 内，禁止跨场取证
    if (enforceScope && !allowedBlockIds.has(fact.sourceBlockId)) {
      violations.push({
        kind: 'fact_out_of_scope',
        path: `${path}[${i}].sourceBlockId`,
        sceneId,
        message: `Fact「${fact.key}」的证据 block ${fact.sourceBlockId} 不属于本场景允许范围（疑似跨场取证）`,
      });
      return;
    }
    if (fact.anchorQuote && !containsQuoteEvidence(block.text, fact.anchorQuote)) {
      violations.push({
        kind: 'quote_not_found',
        path: `${path}[${i}].anchorQuote`,
        sceneId,
        message: `Fact「${fact.key}」引文未在所指原文命中`,
      });
    }
  });
}

export interface RefinementPlanDegradation {
  brief: RefinementBrief;
  degradedSceneIds: string[];
}

/**
 * 保守降级（plan-contract-recovery.md §4）：仅当违规全部落在可降级的**局部场景编辑指令**
 * （如 checks.targetBlockId / protectedSpanIds），且该场原文范围、入场／散场事实与
 * 全章保护事实均已独立验证时，才把整场改为 keep。
 *
 * 以下一律不降级，交由上层暂停：全章级违规、缺 key／无法唯一回填的事实来源、
 * 场景范围或首尾事实本身不可验证、违规场景不在交底内。
 */
export function resolvePlanDegradation(input: {
  brief: RefinementBrief | null;
  violations: RefinementPlanViolation[];
}): RefinementPlanDegradation | null {
  if (!input.brief || input.violations.length === 0) {
    return null;
  }
  const sceneIds = new Set(input.brief.sceneBriefs.map((brief) => brief.sceneId));
  const byScene = new Map<string, RefinementPlanViolation[]>();
  for (const violation of input.violations) {
    if (!violation.sceneId || !sceneIds.has(violation.sceneId)) {
      return null;
    }
    const list = byScene.get(violation.sceneId);
    if (list) {
      list.push(violation);
    } else {
      byScene.set(violation.sceneId, [violation]);
    }
  }
  for (const list of byScene.values()) {
    if (list.some(isNonDegradableViolation)) {
      return null;
    }
  }
  const degradedSceneIds = Array.from(byScene.keys());
  const degradedSet = new Set(degradedSceneIds);
  const sceneBriefs = input.brief.sceneBriefs.map((sceneBrief) =>
    degradedSet.has(sceneBrief.sceneId) ? { ...sceneBrief, decision: 'keep' as const } : sceneBrief
  );
  return { brief: { ...input.brief, sceneBriefs }, degradedSceneIds };
}

function isNonDegradableViolation(violation: RefinementPlanViolation): boolean {
  if (
    violation.kind === 'schema' ||
    violation.kind === 'missing_fact_source' ||
    violation.kind === 'ambiguous_backfill' ||
    violation.kind === 'fact_downgraded' ||
    violation.kind === 'fact_dropped' ||
    violation.kind === 'fact_out_of_scope'
  ) {
    return true;
  }
  // 场景原文范围或首尾事实本身不可验证 → 不降级
  return (
    violation.path.includes('sourceBlockIds') ||
    violation.path.includes('entryFacts') ||
    violation.path.includes('exitFacts')
  );
}

export function parseReviewResult(raw: string): RefinementReviewResult {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new RefinementModelOutputError('review 输出未包含 JSON 对象');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RefinementModelOutputError('review 输出 JSON 解析失败');
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new RefinementModelOutputError('review 输出必须是对象');
  }
  const issuesRaw = Array.isArray(record.issues) ? record.issues : [];
  const issues: RefinementReviewIssue[] = issuesRaw.map((item) => {
    const issue = asRecord(item);
    if (!issue) {
      throw new RefinementModelOutputError('review issues 项必须是对象');
    }
    const kind = asString(issue.kind);
    if (
      kind !== 'hard_constraint' &&
      kind !== 'continuity' &&
      kind !== 'style' &&
      kind !== 'coverage'
    ) {
      throw new RefinementModelOutputError(`review issue.kind 非法: ${kind}`);
    }
    const severity = asString(issue.severity);
    return {
      kind,
      severity: severity === 'high' || severity === 'low' ? severity : 'medium',
      anchorQuote: asString(issue.anchorQuote),
      expectedFact: asString(issue.expectedFact),
      sourceEvidence: asString(issue.sourceEvidence),
      fixIntent: asString(issue.fixIntent),
    };
  });
  return { issues, exitStateFacts: parseFactList(record.exitStateFacts) };
}

// ── Prompt 拼装 ───────────────────────────────────────────────────────

export function describeRefinementPolicy(policy: 'preserve-plot' | 'scene-rewrite'): string {
  return policy === 'scene-rewrite'
    ? '场内创编：允许同场增删、并拍与顺序调整；仍锁定首尾事实及后文依赖，禁止跨场移动事件或新增影响后续的关系转折。'
    : '保留剧情：可改变表达、对话组织、节奏与铺陈；必要事件、人物关系落点、伏笔、范围入场／散场事实必须保持。';
}

export function buildInspectUserPrompt(input: {
  windowId: string;
  instruction: string;
  rewritePolicy: 'preserve-plot' | 'scene-rewrite';
  windowText: string;
  windowIndex?: string;
  readOnlyPrefixText?: string;
  readOnlySuffixText?: string;
  contractError?: string;
}): string {
  const sections: string[] = [
    `【本轮精修要求】\n${input.instruction}`,
    `【改写权限】\n${describeRefinementPolicy(input.rewritePolicy)}`,
  ];
  if (input.windowIndex?.trim()) {
    sections.push(`【本窗 source block 索引（引用 blockId，不得自造偏移）】\n${input.windowIndex}`);
  }
  sections.push(
    '【诊断事实的证据边界】\nentryFacts / exitFacts 的有值事实只能引用当前 <diagnosis-window> 正文内可确认的证据，' +
      'sourceBlockId 必须属于本窗索引，anchorQuote 必须是当前目标正文中的原文片段。' +
      '只读邻文用于理解衔接，不得把邻文引文标到本窗 block，也不得把邻文独有信息写成本窗有值事实；' +
      '当前目标内无法确认的状态使用 {"key": "事实名", "value": null}，不编造或概括引文。',
    `【当前诊断窗】\n<diagnosis-window id="${input.windowId}">\n${input.windowText}\n</diagnosis-window>`
  );
  if (input.readOnlyPrefixText?.trim()) {
    sections.push(
      `【窗口前只读邻文（不得作为修改目标或本窗事实证据）】\n` +
        `<read-only-neighbor side="before">\n${input.readOnlyPrefixText}\n</read-only-neighbor>`
    );
  }
  if (input.readOnlySuffixText?.trim()) {
    sections.push(
      `【窗口后只读邻文（不得作为修改目标或本窗事实证据）】\n` +
        `<read-only-neighbor side="after">\n${input.readOnlySuffixText}\n</read-only-neighbor>`
    );
  }
  if (input.contractError) {
    sections.push(
      '【上一版诊断未通过校验，请修正后重新输出完整 JSON】\n' +
        '保持当前 windowId 和诊断目标，只修正下列合同错误；不得输出补丁、解释或改写正文。' +
        '有值事实需提供本窗原文证据；无法在目标正文确认的事实保持 unknown。\n' +
        input.contractError
    );
  }
  return sections.join('\n\n');
}

export function buildPlanUserPrompt(input: {
  instruction: string;
  rewritePolicy: 'preserve-plot' | 'scene-rewrite';
  inspections: RefinementWindowInspection[];
  sceneIndex: string;
  /** 程序验证并划分的整场首尾 / 中途事实，不要求模型重新判断事实角色。 */
  factIndex?: RefinementFactIndexEntry[];
  /** AQ-383：上一版 plan 的合同违规路径，要求重新输出完整 JSON 而非补丁 */
  contractErrors?: string[];
}): string {
  const sections: string[] = [
    `【本轮精修要求】\n${input.instruction}`,
    `【改写权限】\n${describeRefinementPolicy(input.rewritePolicy)}`,
    `【场景索引】\n${input.sceneIndex}`,
    `【逐窗诊断结果（JSON）】\n${JSON.stringify(input.inspections)}`,
    '【逐字锁与事实保留的区别】\nprotectedSpanIds 中每个 ID 表示对应整块原文逐字保留，' +
      '包括标点与措辞；没有字面不可变要求时使用空数组。只用于用户明确要求逐字保留的块、' +
      '固定系统提示或不可改措辞的引用文本。必要事件、情绪、伏笔及事实证据引文需要语义保留，' +
      '不因此加入 protectedSpanIds。准备润色、去重或重组的整块正文不能同时设为逐字锁；' +
      '若该块确实必须逐字保留，改动意图应避开该块。',
  ];
  if (input.factIndex) {
    sections.push(
      `【已验证事实角色索引（JSON）】\n${JSON.stringify(input.factIndex)}\n` +
        'entry / exit 分别对应整场入场 / 散场；process 是中途已发生的过程，不能锁成整场首尾。' +
        '按所属 sceneId 与 role 继承边界事实及其来源，不把中间片段的状态并入首尾。' +
        'process 由程序传递给成稿和检查，模型无需新增 processFacts 字段；不同时间的同名状态可有不同值。'
    );
  }
  if (input.contractErrors?.length) {
    sections.push(
      `【上一版方案未通过合同校验，请重新输出完整 JSON，不要输出补丁或解释】\n` +
        `必须同时包含 chapterIntent、protectedFacts、sceneBriefs 三个顶层字段；sceneBriefs 不得省略、不得为空，` +
        `且每个场景的 sourceBlockIds、entryFacts、exitFacts 必须齐全。\n` +
        `所有 Fact 的 sourceBlockId 与 anchorQuote 必须从【逐窗诊断结果】中逐字复制对应事实：anchorQuote 必须是该 block 原文中连续出现的片段，` +
        `不得改写、概括、跨句拼接或补字；已验证事实不得降级为 value=null，未获证据支持的新事实才使用 value=null。\n${input.contractErrors
          .map((item) => `- ${item}`)
          .join('\n')}`
    );
  }
  return sections.join('\n\n');
}

function buildProcessFactsPromptBlock(
  facts: RefinementFact[] | undefined,
  rangeOriginal: string
): string {
  const relevant = (facts ?? []).filter(
    (fact) =>
      fact.value !== null &&
      fact.anchorQuote &&
      containsQuoteEvidence(rangeOriginal, fact.anchorQuote)
  );
  return (
    `【必要过程事实（不是首尾状态）】\n${JSON.stringify(relevant)}\n` +
    '保留当前范围内这些已发生的过程及必要顺序；不把中途状态写成入场或散场状态，不补写范围外事件。'
  );
}

export function buildRewriteUserPrompt(input: {
  instruction: string;
  chapterIntent: string;
  protectedFacts: RefinementFact[];
  protectedQuotes: string[];
  sceneBrief: RefinementSceneBrief;
  policy: 'preserve-plot' | 'scene-rewrite';
  acceptedPrefix?: string;
  readOnlyFuture?: string;
  rangeText: string;
  /** F5：前序单位已确认、有证据的状态事实（只读，须保持一致） */
  stateFacts?: string[];
}): string {
  const brief = input.sceneBrief;
  const sections: string[] = [
    `【本轮精修要求】\n${input.instruction}`,
    `【本章意图】\n${input.chapterIntent || '（未提供）'}`,
    `【改写权限】\n${describeRefinementPolicy(input.policy)}`,
    `【本场交底】\n决策：${brief.decision}\n改动意图：${brief.editIntent}\n预期变化：${brief.expectedChange}\n篇幅方向：${describeTargetLength(brief.targetLength)}`,
    `【必要事实与首尾状态（须保留语义，措辞可改；只有逐字锁才要求字面不变）】\n本章锁定事实：${JSON.stringify(input.protectedFacts)}\n入场事实：${JSON.stringify(brief.entryFacts)}\n散场事实：${JSON.stringify(brief.exitFacts)}`,
    `【逐字锁】\n${JSON.stringify(input.protectedQuotes)}\n以上片段须逐字保留，其他正文按交底改写；事实中的 anchorQuote 是来源证据，不是逐字锁。`,
    buildProcessFactsPromptBlock(brief.processFacts, input.rangeText),
  ];
  if (input.stateFacts?.length) {
    sections.push(`【前文已确认的当前状态（有证据，须保持一致）】\n${input.stateFacts.join('\n')}`);
  }
  if (input.acceptedPrefix?.trim()) {
    sections.push(`【已接受的已改写前文（只读，承接用）】\n${input.acceptedPrefix}`);
  }
  if (input.readOnlyFuture?.trim()) {
    sections.push(`【尚未改写的后文开头（只读，禁止改写或复述）】\n${input.readOnlyFuture}`);
  }
  sections.push(`【当前写作范围原文】\n<range>\n${input.rangeText}\n</range>`);
  return sections.join('\n\n');
}

export function buildReviewUserPrompt(input: {
  instruction: string;
  protectedFacts: RefinementFact[];
  sceneBrief: RefinementSceneBrief;
  protectedQuotes: string[];
  rangeOriginal: string;
  candidate: string;
  readOnlyFuture?: string;
  /** F5：给 review 真实的已接受前文，用于连续的接缝与状态判断 */
  acceptedPrefix?: string;
  /** F5：前序单位已确认、有证据的状态事实 */
  stateFacts?: string[];
}): string {
  const sections: string[] = [
    `【本轮精修要求】\n${input.instruction}`,
    `【本场交底】\n决策：${input.sceneBrief.decision}\n改动意图：${input.sceneBrief.editIntent}\n预期变化：${input.sceneBrief.expectedChange}`,
    `【必要事实与首尾状态（须保留语义，措辞可改；只有逐字锁才要求字面不变）】\n本章锁定事实：${JSON.stringify(
      input.protectedFacts
    )}\n入场事实：${JSON.stringify(input.sceneBrief.entryFacts)}\n散场事实：${JSON.stringify(
      input.sceneBrief.exitFacts
    )}`,
    `【逐字锁】\n${input.protectedQuotes.length ? JSON.stringify(input.protectedQuotes) : '（无）'}`,
    buildProcessFactsPromptBlock(input.sceneBrief.processFacts, input.rangeOriginal),
  ];
  if (input.stateFacts?.length) {
    sections.push(
      `【前文已确认的当前状态（有证据；续写须与之一致，冲突请报 continuity）】\n${input.stateFacts.join(
        '\n'
      )}`
    );
  }
  if (input.acceptedPrefix?.trim()) {
    sections.push(`【已接受的已改写前文（只读，用于接缝与状态判断）】\n${input.acceptedPrefix}`);
  }
  sections.push(
    `【冻结原文】\n<original>\n${input.rangeOriginal}\n</original>`,
    `【候选正文】\n<candidate>\n${input.candidate}\n</candidate>`
  );
  if (input.readOnlyFuture?.trim()) {
    sections.push(`【范围后文（只读，用于接缝判断）】\n${input.readOnlyFuture}`);
  }
  return sections.join('\n\n');
}

export function buildRepairUserPrompt(input: {
  gaps: string[];
  protectedQuotes: string[];
  candidateRange: string;
  rangeOriginal?: string;
  processFacts?: RefinementFact[];
  acceptedPrefix?: string;
  readOnlyFuture?: string;
}): string {
  const sections: string[] = [
    `【需要修复的具体缺口】\n${input.gaps.map((gap) => `- ${gap}`).join('\n')}`,
    `【逐字锁】\n${input.protectedQuotes.length ? JSON.stringify(input.protectedQuotes) : '（无）'}`,
    buildProcessFactsPromptBlock(input.processFacts, input.rangeOriginal ?? input.candidateRange),
  ];
  if (input.acceptedPrefix?.trim()) {
    sections.push(`【已接受前文（只读，承接用）】\n${input.acceptedPrefix}`);
  }
  if (input.readOnlyFuture?.trim()) {
    sections.push(`【范围后文（只读）】\n${input.readOnlyFuture}`);
  }
  sections.push(`【当前候选范围】\n<candidate>\n${input.candidateRange}\n</candidate>`);
  return sections.join('\n\n');
}

/** 最终整章检查的已改写范围视图：原文、候选与两侧接缝上下文（按原文顺序）。 */
export interface RefinementSeamRange {
  sceneId: string;
  original: string;
  candidate: string;
  prefix: string;
  suffix: string;
  processFacts?: RefinementFact[];
}

/**
 * 最终整章接缝检查的 user prompt（R7/R11、design D7/D8）。
 *
 * 与逐单位 review 的区别：这里把所有**已改写范围**连同其两侧接缝一起交给模型，
 * 用于发现跨范围的目标遗漏、悬空指代与相邻范围冲突——单看一个单位看不出来的问题。
 * 复用 `review` 模板与 `parseReviewResult`，不新增模板 key 或合同字段。
 */
export function buildFinalSeamReviewUserPrompt(input: {
  instruction: string;
  chapterIntent: string;
  protectedFacts: RefinementFact[];
  ranges: RefinementSeamRange[];
}): string {
  const sections: string[] = [
    `【本轮精修要求】\n${input.instruction}`,
    `【本章意图】\n${input.chapterIntent || '（未提供）'}`,
    `【本章锁定事实（语义保留，措辞可改；只有逐字锁要求字面不变）】\n${JSON.stringify(
      input.protectedFacts
    )}`,
  ];
  const blocks = input.ranges.map((range) => {
    const parts = [
      `<range id="${range.sceneId}">`,
      `<original>${range.original}</original>`,
      `<candidate>${range.candidate}</candidate>`,
      buildProcessFactsPromptBlock(range.processFacts, range.original),
    ];
    if (range.prefix.trim()) {
      parts.push(`<prefix>${range.prefix}</prefix>`);
    }
    if (range.suffix.trim()) {
      parts.push(`<suffix>${range.suffix}</suffix>`);
    }
    parts.push('</range>');
    return parts.join('\n');
  });
  sections.push(`【已改写范围与相邻接缝（按原文顺序，只检查这些范围）】\n${blocks.join('\n\n')}`);
  sections.push(
    [
      '【检查要求】',
      '只报告下列问题：本轮要求未落实、必要事件或首尾状态丢失、悬空指代、相邻范围或与未改写邻文冲突。',
      '不要提出「可以更丰富」之类的风格愿望；孤立的主观评分不构成问题。',
      '每条 issue 给出：kind（hard_constraint/continuity/coverage/style）、severity（high/medium/low）、',
      'anchorQuote（必须逐字出现在对应 candidate 中，用于定位；否则无法自动补修）、expectedFact、fixIntent。',
      '没有任何问题时返回 {"issues": [], "exitStateFacts": []}。',
      'exitStateFacts 只报范围末尾仍成立的当前状态：value 必填，exitEvidence.exitAnchorQuote 必须逐字出现在 candidate 末尾且只出现一次、value 包含于其中；之后若还有同一状态的后续变化填 supersededBy，无法确认填 uncertain:true；无法给出末态锚点的不要上报。',
    ].join('\n')
  );
  return sections.join('\n\n');
}

function describeTargetLength(target: RefinementSceneBrief['targetLength']): string {
  const label =
    target.direction === 'expand' ? '扩写' : target.direction === 'condense' ? '收紧' : '保持';
  const bounds: string[] = [];
  if (typeof target.minChars === 'number') {
    bounds.push(`下限 ${target.minChars}`);
  }
  if (typeof target.maxChars === 'number') {
    bounds.push(`上限 ${target.maxChars}`);
  }
  return bounds.length ? `${label}（${bounds.join('，')}）` : label;
}

// ── 程序门禁 ──────────────────────────────────────────────────────────

export const REFINEMENT_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /（此处省略）/,
  /\(此处省略\)/,
  /\[原段落保留\]/,
  /【此处省略】/,
  /（略）/,
];

export type RefinementGateFailureCode =
  | 'empty_output'
  | 'placeholder'
  | 'length_overflow'
  | 'quote_missing';

/**
 * 候选稿内容指纹。补修必须针对同一份候选稿（candidateRevision + hash）：
 * 补修返回后重新计算 hash，与发起时不一致说明候选已被改写，拒绝把旧补丁应用到新文本（R6）。
 */
export function hashRefinementCandidate(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface RefinementGateFailure {
  code: RefinementGateFailureCode;
  message: string;
  anchorQuote?: string;
}

export interface RefinementGateResult {
  ok: boolean;
  failures: RefinementGateFailure[];
}

/**
 * 程序可重复验证的门禁：空输出、占位语、长度溢出、逐字锁缺失。
 * 语义正确性（情节遗漏、悬空指代）由 review 阶段负责，不在这里判定。
 */
export function runRefinementProgramGate(input: {
  candidate: string;
  maxChars: number;
  protectedQuotes?: string[];
}): RefinementGateResult {
  const failures: RefinementGateFailure[] = [];
  const text = typeof input.candidate === 'string' ? input.candidate : '';
  if (!text.trim()) {
    failures.push({ code: 'empty_output', message: '候选正文为空' });
    return { ok: false, failures };
  }
  for (const pattern of REFINEMENT_PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      failures.push({ code: 'placeholder', message: `候选含占位语 ${pattern.source}` });
    }
  }
  if (input.maxChars > 0 && text.length > input.maxChars) {
    failures.push({
      code: 'length_overflow',
      message: `候选 ${text.length} 字超出单场上限 ${input.maxChars} 字`,
    });
  }
  for (const quote of input.protectedQuotes ?? []) {
    const needle = quote.trim();
    if (!needle) {
      continue;
    }
    if (!text.includes(needle)) {
      failures.push({ code: 'quote_missing', message: '候选丢失逐字锁内容', anchorQuote: needle });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** 逐字锁在候选中的唯一性校验：返回在候选里出现次数不等于 1 的引文。 */
export function findNonUniqueQuotes(candidate: string, quotes: string[]): string[] {
  return quotes.filter((quote) => {
    const needle = quote.trim();
    if (!needle) {
      return false;
    }
    let count = 0;
    let index = candidate.indexOf(needle);
    while (index >= 0) {
      count += 1;
      if (count > 1) {
        break;
      }
      index = candidate.indexOf(needle, index + needle.length);
    }
    return count !== 1;
  });
}

/** 未定位的 review issue（引文不能在候选中唯一命中）不进入自动补修。 */
export function splitReviewIssuesByLocatability(
  result: RefinementReviewResult,
  candidate: string
): { locatable: RefinementReviewIssue[]; unlocatable: RefinementReviewIssue[] } {
  const locatable: RefinementReviewIssue[] = [];
  const unlocatable: RefinementReviewIssue[] = [];
  for (const issue of result.issues) {
    const quote = issue.anchorQuote.trim();
    if (quote && findNonUniqueQuotes(candidate, [quote]).length === 0) {
      locatable.push(issue);
    } else {
      unlocatable.push(issue);
    }
  }
  return { locatable, unlocatable };
}

/** 需要自动补修的条件：可定位、有明确缺口、且不是纯主观风格建议。 */
export function shouldTriggerRepair(issues: RefinementReviewIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.kind !== 'style' &&
      (issue.severity === 'high' || issue.severity === 'medium') &&
      issue.fixIntent.trim().length > 0
  );
}

/** 应用请求构造：冻结版本锁 + planId=runId + 保留摘要。 */
export function buildRefinementApplyPayload(input: {
  runId: string;
  baseUpdatedAt: string;
  draftText: string;
}): {
  draftText: string;
  expectedChapterUpdatedAt: string;
  planId: string;
  preserveSummary: true;
} {
  return {
    draftText: input.draftText,
    expectedChapterUpdatedAt: input.baseUpdatedAt,
    planId: input.runId,
    preserveSummary: true,
  };
}

// ── 原文分块与场景索引（AQ-381 单场基线） ──────────────────────────────

export interface RefinementSourceBlock {
  id: string;
  startOffset: number;
  endOffset: number;
  text: string;
  /** 与下一块之间的分隔串（保留原始换行，拼回时逐码元还原） */
  separatorAfter: string;
}

/**
 * 按自然段切分冻结原文，保留每块的 UTF-16 精确偏移与分隔串。
 * 兼容 CRLF / LF / 空行 / 单换行：切分不重排、不格式化原文。
 */
export function buildRefinementSourceBlocks(text: string): RefinementSourceBlock[] {
  const blocks: RefinementSourceBlock[] = [];
  let index = 0;
  let cursor = 0;
  const pattern = /\r\n|\n|\r/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  const pushBlock = (end: number, separator: string, separatorEnd: number) => {
    if (end > cursor) {
      blocks.push({
        id: `b${index}`,
        startOffset: cursor,
        endOffset: end,
        text: text.slice(cursor, end),
        separatorAfter: separator,
      });
      index += 1;
    }
    cursor = separatorEnd;
  };
  while (match) {
    pushBlock(match.index, match[0], match.index + match[0].length);
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    pushBlock(text.length, '', text.length);
  }
  return blocks;
}

function previewBlockText(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 40);
}

/** 指定 block 区间的索引文本：给单窗诊断定位 source block，不含原文全文。 */
export function buildRefinementBlockIndexForRange(
  blocks: RefinementSourceBlock[],
  startBlockIndex: number,
  endBlockIndex: number
): string {
  return blocks
    .slice(startBlockIndex, endBlockIndex)
    .map(
      (block) =>
        `${block.id} [${block.startOffset},${block.endOffset}) ${previewBlockText(block.text)}`
    )
    .join('\n');
}

/** 整章 source block 索引：给规划阶段核对覆盖面。 */
export function buildRefinementBlockIndex(blocks: RefinementSourceBlock[]): string {
  return buildRefinementBlockIndexForRange(blocks, 0, blocks.length);
}

// ── 诊断窗规划（AQ-382，覆盖 R3） ─────────────────────────────────────

export const REFINEMENT_DIAGNOSIS_NEIGHBOR_CHARS = 1000;
/** 单块超过诊断目标该倍率才允许在块内部切分 */
const REFINEMENT_LONG_BLOCK_SPLIT_RATIO = 1.5;
const REFINEMENT_SENTENCE_END = /[。！？…!?；;]/;

export interface RefinementDiagnosisWindow {
  id: string;
  /** 覆盖的 block 下标（含，模型可见的引用范围） */
  startBlockIndex: number;
  /** 覆盖的 block 下标（不含） */
  endBlockIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  readOnlyPrefix: string;
  readOnlySuffix: string;
  /** 窗口结束是否落在合法 block 边界；false 表示切在超长自然段内部（只读，不可作写作边界） */
  endsAtBlockBoundary: boolean;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 从 preferredEnd 向前找句末边界；找不到则退到 UTF-16 安全边界，绝不劈开代理对。 */
function resolveDiagnosisSplitOffset(
  text: string,
  lowerBound: number,
  preferredEnd: number,
  hardEnd: number
): number {
  const searchEnd = Math.min(preferredEnd, hardEnd);
  for (let i = searchEnd; i > lowerBound; i -= 1) {
    if (REFINEMENT_SENTENCE_END.test(text[i - 1])) {
      return i;
    }
  }
  let pos = searchEnd;
  if (
    pos > lowerBound &&
    pos < text.length &&
    isHighSurrogate(text.charCodeAt(pos - 1)) &&
    isLowSurrogate(text.charCodeAt(pos))
  ) {
    pos -= 1;
  }
  return pos > lowerBound ? pos : lowerBound + 1;
}

/**
 * 诊断窗规划：按累计 UTF-16 长度切分，优先完整自然段；超长自然段在句末边界切分，
 * 无句末时退到 UTF-16 安全边界。所有窗口首尾相接，拼接逐码元等于原文。
 */
export function planRefinementDiagnosisWindows(input: {
  baseText: string;
  blocks: RefinementSourceBlock[];
  targetChars: number;
  neighborChars?: number;
}): RefinementDiagnosisWindow[] {
  const { baseText, blocks } = input;
  if (blocks.length === 0) {
    return [];
  }
  const target = Math.max(1, Math.round(input.targetChars));
  const neighbor = input.neighborChars ?? REFINEMENT_DIAGNOSIS_NEIGHBOR_CHARS;
  const totalEnd = baseText.length;
  const spanEnds = blocks.map((_, index) =>
    index + 1 < blocks.length ? blocks[index + 1].startOffset : totalEnd
  );
  const validBoundaries = new Set<number>(spanEnds);
  validBoundaries.add(totalEnd);

  const raw: Array<{
    start: number;
    end: number;
    startBlockIndex: number;
    endBlockIndex: number;
  }> = [];
  let start = blocks[0].startOffset;
  let end = start;
  let startBlockIndex = 0;

  const push = (rangeEnd: number, endBlockIndex: number) => {
    if (rangeEnd > start) {
      raw.push({ start, end: rangeEnd, startBlockIndex, endBlockIndex });
    }
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const blockChars = block.endOffset - block.startOffset;
    const spanEnd = spanEnds[i];
    if (blockChars > target * REFINEMENT_LONG_BLOCK_SPLIT_RATIO) {
      if (end > start) {
        push(end, i);
        start = end;
        startBlockIndex = i;
      }
      let pos = block.startOffset;
      while (block.endOffset - pos > target * REFINEMENT_LONG_BLOCK_SPLIT_RATIO) {
        const splitAt = resolveDiagnosisSplitOffset(baseText, pos, pos + target, block.endOffset);
        if (splitAt <= pos || splitAt >= block.endOffset) {
          break;
        }
        push(splitAt, i + 1);
        start = splitAt;
        startBlockIndex = i;
        pos = splitAt;
      }
      end = spanEnd;
      continue;
    }
    if (end > start && end - start + blockChars > target) {
      push(end, i);
      start = block.startOffset;
      startBlockIndex = i;
    }
    end = spanEnd;
  }
  push(end, blocks.length);

  return raw.map((item, index) => ({
    id: `w${index}`,
    startBlockIndex: item.startBlockIndex,
    endBlockIndex: item.endBlockIndex,
    startOffset: item.start,
    endOffset: item.end,
    text: baseText.slice(item.start, item.end),
    readOnlyPrefix: baseText.slice(Math.max(0, item.start - neighbor), item.start),
    readOnlySuffix: baseText.slice(item.end, item.end + neighbor),
    endsAtBlockBoundary: validBoundaries.has(item.end),
  }));
}

// ── 场景合并（AQ-382，覆盖 R4：只按可验证锚点合并） ─────────────────────

export interface RefinementMergedScene {
  sceneId: string;
  windowIds: string[];
  startBlockIndex: number;
  endBlockIndex: number;
  startOffset: number;
  endOffset: number;
  confidence: 'high' | 'low';
  startsNewScene: boolean;
  goals: string[];
  fragments: RefinementSceneFragment[];
}

/**
 * 跨窗场景合并：仅当片段与上一场景在原文中连续、且片段未声明新场景时合并。
 * 不依据标题／目标文本，避免同名独立场景被误并；block 引用不可验证时降级为低置信度。
 */
export function mergeWindowSceneFragments(input: {
  blocks: RefinementSourceBlock[];
  inspections: RefinementWindowInspection[];
}): RefinementMergedScene[] {
  const { blocks } = input;
  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const scenes: RefinementMergedScene[] = [];
  let seq = 0;

  for (const inspection of input.inspections) {
    for (const fragment of inspection.sceneFragments) {
      const rawStart = blockIndexById.get(fragment.startBlockId);
      const rawEnd = blockIndexById.get(fragment.endBlockId);
      if (rawStart === undefined && rawEnd === undefined) {
        continue;
      }
      const startIndex0 = rawStart ?? rawEnd ?? 0;
      const endIndex0 = rawEnd ?? rawStart ?? 0;
      let startIndex = startIndex0;
      const endIndex = Math.max(startIndex0, endIndex0);
      let confidence: 'high' | 'low' =
        rawStart === undefined || rawEnd === undefined ? 'low' : fragment.confidence;

      const prev = scenes[scenes.length - 1];
      if (prev && startIndex < prev.endBlockIndex) {
        // 与上一场景交叠：裁剪到边界，避免产生交叠范围
        startIndex = prev.endBlockIndex;
        confidence = 'low';
      }
      if (startIndex > endIndex) {
        continue;
      }

      if (prev && prev.endBlockIndex === startIndex && !fragment.startsNewScene) {
        prev.endBlockIndex = endIndex + 1;
        prev.endOffset = blocks[endIndex].endOffset;
        prev.windowIds.push(inspection.windowId);
        prev.fragments.push(fragment);
        if (confidence === 'low') {
          prev.confidence = 'low';
        }
        if (fragment.goal) {
          prev.goals.push(fragment.goal);
        }
        continue;
      }

      seq += 1;
      scenes.push({
        sceneId: `scene-${seq}`,
        windowIds: [inspection.windowId],
        startBlockIndex: startIndex,
        endBlockIndex: endIndex + 1,
        startOffset: blocks[startIndex].startOffset,
        endOffset: blocks[endIndex].endOffset,
        confidence,
        startsNewScene: fragment.startsNewScene,
        goals: fragment.goal ? [fragment.goal] : [],
        fragments: [fragment],
      });
    }
  }

  return scenes;
}

/** 合并后场景索引：给规划阶段分配 keep/patch/rewrite，并核对 block 覆盖面。 */
export function buildRefinementMergedSceneIndex(
  blocks: RefinementSourceBlock[],
  scenes: RefinementMergedScene[]
): string {
  return scenes
    .map((scene) => {
      const blockIds = blocks
        .slice(scene.startBlockIndex, scene.endBlockIndex)
        .map((block) => block.id)
        .join(',');
      const chars = scene.endOffset - scene.startOffset;
      const confidence = scene.confidence === 'low' ? '低置信度' : '高置信度';
      const goal = scene.goals.join('；') || '（无目标）';
      return `${scene.sceneId}: blocks=[${blockIds}] ${chars}字 ${confidence} ${goal}`;
    })
    .join('\n');
}

// ── 写作单位规划（AQ-382，覆盖 R5：场景优先、拍边界拆分、低置信度降级） ──

export interface RefinementWriteUnit {
  unitId: string;
  sceneId: string;
  decision: 'keep' | 'patch' | 'rewrite';
  startBlockIndex: number;
  endBlockIndex: number;
  /** 内容起始（含） */
  startOffset: number;
  /** 内容结束（不含），不含尾部分隔串 */
  contentEndOffset: number;
  /** 跨度结束（不含）= 下一单位起点或原文末尾，用于逐段拼接 */
  endOffset: number;
  text: string;
  brief: RefinementSceneBrief | null;
  lowConfidence: boolean;
  /** 因超长且无安全拍边界而强制保留原文 */
  retainedForSafety: boolean;
}

export interface RefinementWritePlan {
  units: RefinementWriteUnit[];
  unsplittableSceneIds: string[];
  scenesWithoutBrief: string[];
}

interface RawWriteUnit {
  sceneId: string;
  decision: 'keep' | 'patch' | 'rewrite';
  startBlockIndex: number;
  endBlockIndex: number;
  brief: RefinementSceneBrief | null;
  lowConfidence: boolean;
  retainedForSafety: boolean;
}

/**
 * 交底与合并场景对齐：优先按 sceneId 命中；模型未回填合并后 ID 时，
 * 按 brief.sourceBlockIds 的归属回退到对应场景，避免整场被误判为「无交底」而整体保留原文。
 */
function alignSceneBriefsToScenes(
  scenes: RefinementMergedScene[],
  briefs: RefinementSceneBrief[],
  blocks: RefinementSourceBlock[]
): Map<string, RefinementSceneBrief> {
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const sceneIdByBlockId = new Map<string, string>();
  for (const scene of scenes) {
    for (let i = scene.startBlockIndex; i < scene.endBlockIndex; i += 1) {
      sceneIdByBlockId.set(blocks[i].id, scene.sceneId);
    }
  }
  const aligned = new Map<string, RefinementSceneBrief>();
  for (const brief of briefs) {
    if (sceneIds.has(brief.sceneId)) {
      aligned.set(brief.sceneId, brief);
      continue;
    }
    for (const blockId of brief.sourceBlockIds) {
      const sceneId = sceneIdByBlockId.get(blockId);
      if (sceneId && !aligned.has(sceneId)) {
        aligned.set(sceneId, brief);
        break;
      }
    }
  }
  return aligned;
}

/** 收集场景内可验证的拍边界（block 下标，作为拆分点的排他上界）。 */
function collectVerifiedBeatBoundaries(
  scene: RefinementMergedScene,
  blocks: RefinementSourceBlock[]
): number[] {
  const blockIndexById = new Map(blocks.map((block, index) => [block.id, index]));
  const points = new Set<number>();
  for (const fragment of scene.fragments) {
    for (const beat of fragment.proposedBeatEnds) {
      const anchor = beat.anchorQuote.trim();
      const index = blockIndexById.get(beat.blockId);
      if (index === undefined || !anchor) {
        continue;
      }
      if (index < scene.startBlockIndex || index >= scene.endBlockIndex) {
        continue;
      }
      if (!containsQuoteEvidence(blocks[index].text, anchor)) {
        continue;
      }
      points.add(index + 1);
    }
  }
  return Array.from(points).sort((a, b) => a - b);
}

/**
 * 写作单位规划：每个场景默认一个单位；超长场景只在可验证拍边界拆分；
 * 无安全边界则整场保留原文并记录。未被任何场景覆盖的 block 由程序补 keep 单位，
 * 保证全部 source block 都有覆盖决策。
 */
export function planRefinementWriteUnits(input: {
  baseText: string;
  blocks: RefinementSourceBlock[];
  scenes: RefinementMergedScene[];
  briefs: RefinementSceneBrief[];
  rewriteTargetChars: number;
  rewriteMaxChars: number;
}): RefinementWritePlan {
  const { baseText, blocks } = input;
  const unsplittableSceneIds: string[] = [];
  const scenesWithoutBrief: string[] = [];
  if (blocks.length === 0) {
    return { units: [], unsplittableSceneIds, scenesWithoutBrief };
  }
  const briefByScene = alignSceneBriefsToScenes(input.scenes, input.briefs, blocks);
  const rawUnits: RawWriteUnit[] = [];

  for (const scene of input.scenes) {
    const brief = briefByScene.get(scene.sceneId) ?? null;
    if (!brief) {
      scenesWithoutBrief.push(scene.sceneId);
    }
    const lowConfidence = scene.confidence === 'low';
    const sceneChars = scene.endOffset - scene.startOffset;
    const forceRetain = !brief || brief.decision === 'keep' || lowConfidence;

    if (forceRetain) {
      rawUnits.push({
        sceneId: scene.sceneId,
        decision: 'keep',
        startBlockIndex: scene.startBlockIndex,
        endBlockIndex: scene.endBlockIndex,
        brief,
        lowConfidence,
        retainedForSafety: !brief || lowConfidence,
      });
      continue;
    }

    if (sceneChars <= input.rewriteMaxChars) {
      rawUnits.push({
        sceneId: scene.sceneId,
        decision: brief.decision,
        startBlockIndex: scene.startBlockIndex,
        endBlockIndex: scene.endBlockIndex,
        brief,
        lowConfidence: false,
        retainedForSafety: false,
      });
      continue;
    }

    const splitPoints = [
      scene.startBlockIndex,
      ...collectVerifiedBeatBoundaries(scene, blocks),
      scene.endBlockIndex,
    ];
    const chunks: Array<[number, number]> = [];
    let cursor = scene.startBlockIndex;
    let splittable = true;
    while (cursor < scene.endBlockIndex) {
      let best = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const point of splitPoints) {
        if (point <= cursor) {
          continue;
        }
        const chars = blocks[point - 1].endOffset - blocks[cursor].startOffset;
        if (chars > input.rewriteMaxChars) {
          break;
        }
        const score = Math.abs(chars - input.rewriteTargetChars);
        if (score < bestScore) {
          bestScore = score;
          best = point;
        }
      }
      if (best === -1) {
        splittable = false;
        break;
      }
      chunks.push([cursor, best]);
      cursor = best;
    }

    if (!splittable || chunks.length === 0) {
      unsplittableSceneIds.push(scene.sceneId);
      rawUnits.push({
        sceneId: scene.sceneId,
        decision: 'keep',
        startBlockIndex: scene.startBlockIndex,
        endBlockIndex: scene.endBlockIndex,
        brief,
        lowConfidence: false,
        retainedForSafety: true,
      });
      continue;
    }

    for (const [chunkStart, chunkEnd] of chunks) {
      rawUnits.push({
        sceneId: scene.sceneId,
        decision: brief.decision,
        startBlockIndex: chunkStart,
        endBlockIndex: chunkEnd,
        brief,
        lowConfidence: false,
        retainedForSafety: false,
      });
    }
  }

  // 覆盖修复：未被任何场景覆盖的 block 补 keep 单位
  const covered = new Array<boolean>(blocks.length).fill(false);
  for (const unit of rawUnits) {
    for (let i = unit.startBlockIndex; i < unit.endBlockIndex; i += 1) {
      covered[i] = true;
    }
  }
  let index = 0;
  while (index < blocks.length) {
    if (covered[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < blocks.length && !covered[end]) {
      end += 1;
    }
    rawUnits.push({
      sceneId: `uncovered-${index}`,
      decision: 'keep',
      startBlockIndex: index,
      endBlockIndex: end,
      brief: null,
      lowConfidence: true,
      retainedForSafety: true,
    });
    index = end;
  }

  rawUnits.sort((a, b) => a.startBlockIndex - b.startBlockIndex);

  const units: RefinementWriteUnit[] = rawUnits.map((unit, unitIndex) => {
    const startOffset = blocks[unit.startBlockIndex].startOffset;
    const contentEndOffset = blocks[unit.endBlockIndex - 1].endOffset;
    const nextStart =
      unitIndex + 1 < rawUnits.length
        ? blocks[rawUnits[unitIndex + 1].startBlockIndex].startOffset
        : baseText.length;
    return {
      unitId: `u${unitIndex}`,
      sceneId: unit.sceneId,
      decision: unit.decision,
      startBlockIndex: unit.startBlockIndex,
      endBlockIndex: unit.endBlockIndex,
      startOffset,
      contentEndOffset,
      endOffset: Math.max(nextStart, contentEndOffset),
      text: baseText.slice(startOffset, contentEndOffset),
      brief: unit.brief,
      lowConfidence: unit.lowConfidence,
      retainedForSafety: unit.retainedForSafety,
    };
  });

  return { units, unsplittableSceneIds, scenesWithoutBrief };
}

// ── 按原文偏移合并与覆盖面统计（AQ-382，覆盖 R6） ─────────────────────

export interface RefinementReplacement {
  startOffset: number;
  endOffset: number;
  replacement: string;
}

/**
 * 按冻结原文偏移合并替换：替换按起始偏移排序、不得交叠；未命中区间逐码元保留。
 * 每个单位用原文偏移定位，前序单位长度变化不会导致后续替换漂移。
 */
export function assembleRefinementCandidate(input: {
  baseText: string;
  replacements: RefinementReplacement[];
}): string {
  const sorted = [...input.replacements].sort((a, b) => a.startOffset - b.startOffset);
  let cursor = 0;
  let out = '';
  for (const item of sorted) {
    if (item.startOffset < cursor || item.endOffset < item.startOffset) {
      throw new RefinementModelOutputError('替换范围交叠或非法，拒绝拼装候选稿');
    }
    out += input.baseText.slice(cursor, item.startOffset) + item.replacement;
    cursor = item.endOffset;
  }
  out += input.baseText.slice(cursor);
  return out;
}

/** 覆盖面统计：processedChars 为本轮已处理跨度，retainedOriginalChars 为仍为原文的部分。 */
export function summarizeRefinementCoverage(input: {
  sourceChars: number;
  units: Array<{ startOffset: number; endOffset: number; retainedOriginal: boolean }>;
}): RefinementCoverage {
  let processedChars = 0;
  let retainedOriginalChars = 0;
  for (const unit of input.units) {
    const chars = Math.max(0, unit.endOffset - unit.startOffset);
    processedChars += chars;
    if (unit.retainedOriginal) {
      retainedOriginalChars += chars;
    }
  }
  return {
    sourceChars: input.sourceChars,
    plannedChars: processedChars,
    processedChars,
    retainedOriginalChars,
  };
}

/** 程序门禁的单场长度上限：正常范围用策略上限，超长单段留出安全余量避免误杀。 */
export function resolveRefinementRangeMaxChars(rangeChars: number, policyMaxChars: number): number {
  if (rangeChars <= policyMaxChars) {
    return policyMaxChars;
  }
  return Math.max(policyMaxChars, Math.ceil(rangeChars * 1.5));
}

/**
 * 逐字锁：仅来自 plan 显式标注的 `protectedSpanIds`（按 source block id 解析为整块原文）。
 * 语义是「必须逐字保留」的原文，例如便签、系统提示、不可改措辞的固定文本。
 *
 * 只取落在**当前写作单位**范围内的锁：同一场景可能被拆成多个单位分别改写，
 * 若按整场范围取锁，每个单位都会背上别的单位的锁，除极少数单位外全部误判丢失而退回原文。
 *
 * 不把 `protectedFacts` / 首尾事实的 `anchorQuote` 当逐字锁：那只是**证据引文**，
 * 用来证明事实存在；改写本就要改措辞，按字面锁定会误杀正常改写。
 * design D8 把「首尾状态冲突」归为模型检查（review），只有逐字锁才是程序门禁。
 */
export function deriveProtectedQuotes(input: {
  sceneBrief: RefinementSceneBrief;
  blocks: RefinementSourceBlock[];
  startBlockIndex: number;
  endBlockIndex: number;
}): string[] {
  const blockIndexById = new Map(input.blocks.map((block, index) => [block.id, index]));
  const quotes = new Set<string>();
  for (const spanId of input.sceneBrief.protectedSpanIds) {
    const index = blockIndexById.get(spanId);
    if (index === undefined || index < input.startBlockIndex || index >= input.endBlockIndex) {
      continue;
    }
    const text = input.blocks[index].text.trim();
    if (text) {
      quotes.add(text);
    }
  }
  return Array.from(quotes);
}
