/**
 * 分步章节精修流水线工具（AQ-273~280）
 *
 * 模板治理同步：
 *  - `task-prompt-defaults.ts`
 *  - `rag-orchestrator/.../task-prompt-defaults.ts`
 */

import { createHash, randomUUID } from 'node:crypto';
import { scanContentSafety, type ContentSafetyRule } from '@aether-quill/config';
import {
  clampChapterOptimizeSegmentCharSize,
  resolveChapterOptimizeConfigWithProjectOverride,
  resolveChapterOptimizeLengthStrategy,
  splitIntoSegments,
  type ChapterOptimizeConfig,
} from './chapter-optimize.util';

// ── Template keys ──────────────────────────────────────────────

export const CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY = 'chapter.pipeline.character';
export const CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY = 'chapter.pipeline.character.outline';
export const CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY =
  'chapter.pipeline.character-traits.outline';
export const CHAPTER_PIPELINE_CHARACTER_TRAITS_TEMPLATE_KEY = 'chapter.pipeline.character-traits';
export const CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY = 'chapter.pipeline.sensory.outline';
export const CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY = 'chapter.pipeline.sensory.rewrite';
export const CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY = 'chapter.pipeline.rules.scan';
export const CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY = 'chapter.pipeline.rules.fix';
export const CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY =
  'chapter.pipeline.homogenization.scan';
export const CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY =
  'chapter.pipeline.homogenization.rewrite';

export const CHAPTER_PIPELINE_TEMPLATE_KEYS = [
  CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY,
] as const;

// ── System prompt seeds ────────────────────────────────────────

const DIMENSION_BOUNDARY = '【维度边界】本步骤 ONLY 负责本模块职责；禁止修改其他维度的内容。';

export const CHAPTER_PIPELINE_CHARACTER_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对章节正文进行「角色维度」精修。',
  DIMENSION_BOUNDARY,
  'ONLY：严格按已确认的 <character-outline> 校对话风格、行为反应、人物互动方式、情感表达。',
  '禁止：修改感官描写密度与质量、禁用词与叙事规则、解释型说明、跨章写法、角色卡特征硬补（特征归模块一-b）。',
  '直接输出改写后的完整章节正文，不要输出方案、说明或 Markdown。',
  '必须以下文 <chapter-original> 为蓝本；输出语言、人称、人物名称与原文保持一致。',
].join('\n');

export const CHAPTER_PIPELINE_CHARACTER_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对章节正文制定「角色调整大纲」。',
  DIMENSION_BOUNDARY,
  'ONLY：分析对白口吻、行为反应、互动方式等待调整项，列出修改方向。',
  '禁止：输出正文、修改感官描写、禁用词、角色卡特征补缺（特征归模块一-b）。',
  '只输出 JSON，结构：{"required":[{"id":"r1","text":"...","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
  '📌 required = 必须调整项；✨ suggested = 建议调整项。',
].join('\n');

/** 角色调整大纲 user 侧 JSON 格式（每次请求附带，避免自定义 system 写成「诊断报告」时模型输出散文） */
export const CHAPTER_PIPELINE_CHARACTER_OUTLINE_JSON_FORMAT = [
  '只输出一个 JSON 对象（不要 Markdown 代码块、不要报告式说明、不要「以下是…」类前言）：',
  '{"required":[{"id":"r1","text":"【角色名-问题类型】定位原文 + 冲突描述 + 修改方向","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
  '每条仅允许 id、text、priority（选填 personaName/featureRef/anchorHint）；禁止 character、category、location、problem、fix 等分散字段。',
  '如无需要调整项，对应数组为 []。',
].join('\n');

/** 特征润色大纲唯一合法 JSON 形态（写入 system / user prompt，解析器亦兼容历史变体） */
export const CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_JSON_FORMAT = [
  '只输出一个 JSON 对象（不要 Markdown 代码块、不要根级数组、不要用 character_adjustments 等其它字段名）：',
  '{"required":[{"id":"r1","text":"【角色名】缺失特征：……。建议插入：……","priority":"required","personaName":"角色名","featureRef":"角色卡摘录","anchorHint":"落笔位置"}],"suggested":[{"id":"s1","text":"……","priority":"suggested","personaName":"角色名","featureRef":"……","anchorHint":"……"}]}',
  '📌 required = 角色卡硬性要求且本章可补；✨ suggested = 可补可不补或场景边缘；无缺失则对应数组为 []。',
  '每条必须有 text；personaName / featureRef / anchorHint 选填但推荐填写。',
].join('\n');

export const CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对章节正文制定「角色特征润色大纲」。',
  DIMENSION_BOUNDARY,
  'ONLY：对照人物卡，识别本章正文中缺失的、角色卡明确要求的外观/气质/习惯等特征描写。',
  '禁止：修改对白、情节走向、体位顺序、感官描写；禁止补充角色卡未写明的特征。',
  CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_JSON_FORMAT,
].join('\n');

export const CHAPTER_PIPELINE_CHARACTER_TRAITS_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按已确认的特征润色大纲补充角色卡特征描写。',
  DIMENSION_BOUNDARY,
  'ONLY：在合理场景插入或微调相邻句以补足特征；不改动既有情节骨架。',
  '禁止：修改对白内容/口吻、情节走向、人物出场顺序、体位顺序；禁止新增或删除对白句子、人物、体位、场景。',
  '直接输出完整正文，不要输出说明或 Markdown。',
].join('\n');

export const CHAPTER_PIPELINE_SENSORY_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对章节正文制定「感官优化大纲」。',
  DIMENSION_BOUNDARY,
  'ONLY：分析亲密场景的感官描写质量，列出需加强或调整的感官要点。',
  '禁止：修改角色性格、对白口吻；禁止在建议中写出可直接粘贴进正文的成品描写例句。',
  '每条建议的 text 只写「问题定位 + 修改方向 + 感官切入角度」，不得包含引号内的示例句子、不得写出具体比喻或器官级描写。',
  '只输出 JSON，结构：{"required":[{"id":"r1","text":"...","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
  '📌 required = 必须优化项；✨ suggested = 建议优化项。',
].join('\n');

export const CHAPTER_PIPELINE_SENSORY_REWRITE_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按已确认的感官优化大纲改写章节正文。',
  DIMENSION_BOUNDARY,
  'ONLY：按 <sensory-outline> 提升感官描写质量。',
  '禁止：修改角色性格、对白口吻、禁用词、剧情走向。',
  '大纲每条 text 仅为方向性指引；具体描写由你创作，不得照搬大纲中的任何短语或例句。',
  '直接输出完整正文，不要输出说明或 Markdown。',
].join('\n');

export const CHAPTER_PIPELINE_RULES_SCAN_SYSTEM_PROMPT = [
  '你是一位资深小说规则审查员，正在扫描章节正文中的规则违规项。',
  DIMENSION_BOUNDARY,
  'ONLY：扫描并列清单；禁止改正文。',
  '只输出 JSON：{"issues":[{"id":"...","category":"...","text":"违规片段","context":"上下文","fixStrategy":"auto|ai_segment|manual","startOffset":0,"endOffset":0}]}',
  'category 可选：forbidden_word, explanatory_text, pronoun_mismatch, gendered_word_male, fluid_oral_contact, rear_kiss, position_teleport, multi_pov。',
].join('\n');

export const CHAPTER_PIPELINE_RULES_FIX_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在按单条规则 issue 局部修复章节正文片段。',
  DIMENSION_BOUNDARY,
  'ONLY：修复 <rule-issue> 标注的违规；禁止越界改写其他维度。',
  '输出替换后的完整段落（含上下文衔接），不要输出说明。',
].join('\n');

export const CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在检测本章与前序章节的写法同质化问题。',
  DIMENSION_BOUNDARY,
  'ONLY：比对重复句式、套路化描写；禁止改正文。',
  '只输出 JSON：{"issues":[{"id":"...","text":"重复片段","priorChapterNo":1,"suggestion":"替换建议"}]}',
].join('\n');

export const CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_SYSTEM_PROMPT = [
  '你是一位资深小说写作助手，正在按同质化检测报告局部替换重复写法。',
  DIMENSION_BOUNDARY,
  'ONLY：按 <homogenization-report> 替换标注片段；禁止修改角色、感官、规则维度。',
  '直接输出完整章节正文。',
].join('\n');

// ── Types ──────────────────────────────────────────────────────

export type ChapterPipelinePreset = 'full' | 'character_rules' | 'sensory_only';
export type ChapterPipelineRulesFixMode = 'auto' | 'semi' | 'manual';
export type ChapterPipelineModule = 1 | 2 | 3 | 4;
export type ChapterPipelineRunModule =
  | 'character-outline'
  | 'character'
  | 'character-traits-outline'
  | 'character-traits'
  | 'sensory-outline'
  | 'sensory-rewrite'
  | 'rules-scan'
  | 'rules-fix'
  | 'homogenization'
  | 'homogenization-scan'
  | 'homogenization-rewrite'
  | 'run-all'
  | 'final-polish';

export type ChapterPipelineOutlineType = 'character' | 'character-traits' | 'sensory';
export type ChapterPipelineOutlineReviseMode = 'recheck' | 'revise';

export type ChapterPipelineOutlineGate =
  | 'character-outline'
  | 'character-traits-outline'
  | 'sensory-outline';

export type ChapterPipelineStage =
  | 'pipeline_character_outline'
  | 'pipeline_character'
  | 'pipeline_character_traits_outline'
  | 'pipeline_character_traits'
  | 'pipeline_sensory_outline'
  | 'pipeline_sensory_rewrite'
  | 'pipeline_rules_scan'
  | 'pipeline_rules_fix'
  | 'pipeline_homogenization_scan'
  | 'pipeline_homogenization_rewrite'
  | 'pipeline_final_polish_done'
  | 'compliance_outline'
  | 'compliance_rewrite'
  | 'compliance_rewrite_segment'
  | 'compliance_rescan'
  | 'draft_segment'
  | 'merge_validation';

export type FinalPolishQualityStatus = 'passed' | 'passed_with_warnings' | 'blocked';

export interface FinalPolishResult {
  fingerprint: string;
  versionText: string;
  residualIssues: PipelineRuleIssue[];
  qualityStatus: FinalPolishQualityStatus;
  traceIds: Record<string, string>;
  createdAt: string;
  cached?: boolean;
}

export type PipelineRuleCategory =
  | 'forbidden_word'
  | 'explanatory_text'
  | 'pronoun_mismatch'
  | 'gendered_word_male'
  | 'fluid_oral_contact'
  | 'rear_kiss'
  | 'position_teleport'
  | 'multi_pov';

export type PipelineFixStrategy = 'auto' | 'ai_segment' | 'manual';

/** auto 修复允许的最大匹配长度（字符）；超出则降级为 manual，避免误删段落 */
export const MAX_AUTO_FIX_SPAN_BY_CATEGORY: Record<PipelineRuleCategory, number> = {
  forbidden_word: 32,
  explanatory_text: 160,
  pronoun_mismatch: 6,
  gendered_word_male: 48,
  fluid_oral_contact: 800,
  rear_kiss: 800,
  position_teleport: 800,
  multi_pov: 800,
};

export const MAX_AI_SEGMENT_REPLACEMENT_CHARS = 1200;

export interface ProtagonistUnlockRule {
  abilityKey: string;
  unlockAtChapter?: number;
  unlockAfterCondition?: string;
  descriptionForPrompt: string;
}

export interface ChapterPipelineConfig {
  pipelinePreset: ChapterPipelinePreset;
  pipelineSkipSensoryOutlineReview: boolean;
  pipelineSkipCharacterOutlineReview: boolean;
  pipelineSkipCharacterTraitsOutlineReview: boolean;
  pipelineCharacterTraitsEnabled: boolean;
  pipelineRulesFixMode: ChapterPipelineRulesFixMode;
  pipelineHomogenizationEnabled: boolean;
  pipelineHomogenizationPriorChapterCount: number;
  pipelineEnabledModules: ChapterPipelineModule[];
}

export interface PipelineOutlineItem {
  id: string;
  text: string;
  priority: 'required' | 'suggested';
  /** 确定性内容安全扫描告警（如禁用词） */
  contentWarnings?: string[];
  personaId?: string;
  personaName?: string;
  featureRef?: string;
  anchorHint?: string;
}

export interface PipelineOutlineState {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  userConfirmed: boolean;
  revisionRound: number;
  /** 最近 N 轮 AI 修订快照，用于撤销 */
  revisionHistory?: Array<{
    required: PipelineOutlineItem[];
    suggested: PipelineOutlineItem[];
  }>;
}

export interface PipelineRuleIssue {
  id: string;
  category: PipelineRuleCategory;
  text: string;
  context: string;
  fixStrategy: PipelineFixStrategy;
  startOffset: number;
  endOffset: number;
  fixed?: boolean;
  /** deterministic = 正则/禁用词引擎；llm = 扫描 Prompt 返回（不可信 offset） */
  source?: 'deterministic' | 'llm';
  /** 内容安全规则 id（自定义禁用词命中时） */
  ruleId?: string;
  /** 低风险 replace 动作的替换文本 */
  replacement?: string;
  contentSafetyAction?: 'mark' | 'replace' | 'rewrite_sentence' | 'block';
}

export interface PipelineHomogenizationIssue {
  id: string;
  text: string;
  priorChapterNo: number;
  suggestion: string;
}

export const PIPELINE_EDITABLE_VERSION_KEYS = [
  'afterCharacter',
  'afterCharacterTraits',
  'afterSensory',
  'afterRules',
  'final',
] as const;

export type PipelineEditableVersionKey = (typeof PIPELINE_EDITABLE_VERSION_KEYS)[number];

export function isPipelineEditableVersionKey(value: string): value is PipelineEditableVersionKey {
  return (PIPELINE_EDITABLE_VERSION_KEYS as readonly string[]).includes(value);
}

export interface ChapterPipelineVersions {
  original: string;
  afterCharacter?: string;
  afterCharacterTraits?: string;
  afterSensory?: string;
  afterRules?: string;
  final?: string;
}

export interface ChapterPipelineSession {
  sessionId: string;
  projectId: string;
  chapterNo: number;
  userId?: string;
  sourceText: string;
  sourceUpdatedAt: string;
  versions: ChapterPipelineVersions;
  /** 用户检索预览确认后注入的角色名（空则回退全部已发布人物） */
  selectedPersonaNames?: string[];
  characterOutline?: PipelineOutlineState;
  characterTraitsOutline?: PipelineOutlineState;
  sensoryOutline?: PipelineOutlineState;
  ruleIssues?: PipelineRuleIssue[];
  homogenizationReport?: PipelineHomogenizationIssue[];
  config: ChapterPipelineConfig;
  currentModule: ChapterPipelineModule | 'done';
  traceIds: Record<string, string>;
  createdAt: Date;
  sessionMode?: 'pipeline' | 'final-polish';
  finalPolishResult?: FinalPolishResult;
}

// ── Defaults ───────────────────────────────────────────────────

export const DEFAULT_PIPELINE_CONFIG: ChapterPipelineConfig = {
  pipelinePreset: 'full',
  pipelineSkipSensoryOutlineReview: false,
  pipelineSkipCharacterOutlineReview: false,
  pipelineSkipCharacterTraitsOutlineReview: false,
  pipelineCharacterTraitsEnabled: true,
  pipelineRulesFixMode: 'semi',
  pipelineHomogenizationEnabled: false,
  pipelineHomogenizationPriorChapterCount: 3,
  pipelineEnabledModules: [1, 2, 3],
};

export const PIPELINE_OUTLINE_REVISION_HISTORY_LIMIT = 5;
export const PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS = 2000;

export const DEFAULT_PROTAGONIST_PROGRESS_RULES: ProtagonistUnlockRule[] = [];

// ── Config resolution ──────────────────────────────────────────

const PRESET_MODULES: Record<ChapterPipelinePreset, ChapterPipelineModule[]> = {
  full: [1, 2, 3, 4],
  character_rules: [1, 3],
  sensory_only: [2],
};

export function resolvePipelineEnabledModules(
  preset: ChapterPipelinePreset,
  homogenizationEnabled: boolean,
  overrideModules?: number[]
): ChapterPipelineModule[] {
  let modules = overrideModules?.length
    ? (overrideModules.filter((m) => m >= 1 && m <= 4) as ChapterPipelineModule[])
    : [...PRESET_MODULES[preset]];
  if (!homogenizationEnabled) {
    modules = modules.filter((m) => m !== 4);
  }
  return [...new Set(modules)].sort((a, b) => a - b);
}

export function mergePipelineConfig(
  projectDefaults: Partial<ChapterPipelineConfig> & {
    protagonistProgressRules?: ProtagonistUnlockRule[];
  },
  overrides?: Partial<ChapterPipelineConfig>
): ChapterPipelineConfig {
  const preset = overrides?.pipelinePreset ?? projectDefaults.pipelinePreset ?? 'full';
  const homogenizationEnabled =
    overrides?.pipelineHomogenizationEnabled ??
    projectDefaults.pipelineHomogenizationEnabled ??
    false;
  const enabledModules = resolvePipelineEnabledModules(
    preset,
    homogenizationEnabled,
    overrides?.pipelineEnabledModules ?? projectDefaults.pipelineEnabledModules
  );
  return {
    pipelinePreset: preset,
    pipelineSkipSensoryOutlineReview:
      overrides?.pipelineSkipSensoryOutlineReview ??
      projectDefaults.pipelineSkipSensoryOutlineReview ??
      false,
    pipelineSkipCharacterOutlineReview:
      overrides?.pipelineSkipCharacterOutlineReview ??
      projectDefaults.pipelineSkipCharacterOutlineReview ??
      false,
    pipelineSkipCharacterTraitsOutlineReview:
      overrides?.pipelineSkipCharacterTraitsOutlineReview ??
      projectDefaults.pipelineSkipCharacterTraitsOutlineReview ??
      false,
    pipelineCharacterTraitsEnabled:
      overrides?.pipelineCharacterTraitsEnabled ??
      projectDefaults.pipelineCharacterTraitsEnabled ??
      true,
    pipelineRulesFixMode:
      overrides?.pipelineRulesFixMode ?? projectDefaults.pipelineRulesFixMode ?? 'semi',
    pipelineHomogenizationEnabled: homogenizationEnabled,
    pipelineHomogenizationPriorChapterCount: Math.min(
      10,
      Math.max(
        1,
        overrides?.pipelineHomogenizationPriorChapterCount ??
          projectDefaults.pipelineHomogenizationPriorChapterCount ??
          3
      )
    ),
    pipelineEnabledModules: enabledModules,
  };
}

export function shouldRunCharacterTraitsModule(config: ChapterPipelineConfig): boolean {
  return config.pipelineCharacterTraitsEnabled && config.pipelineEnabledModules.includes(1);
}

export function filterPipelinePersonas<T extends { name: string; status: string }>(
  personas: T[],
  selectedPersonaNames?: string[]
): T[] {
  const published = personas.filter((persona) => persona.status === 'published');
  if (!selectedPersonaNames?.length) {
    return published;
  }
  const selected = new Set(
    selectedPersonaNames.map((name) => name.trim()).filter((name) => name.length > 0)
  );
  if (selected.size === 0) {
    return published;
  }
  return published.filter((persona) => selected.has(persona.name));
}

export function getPostCharacterText(session: ChapterPipelineSession): string {
  return (
    session.versions.afterCharacterTraits ??
    session.versions.afterCharacter ??
    session.versions.original
  );
}

export function resolveOutlineSkipReview(
  config: ChapterPipelineConfig,
  outlineType: ChapterPipelineOutlineType
): boolean {
  switch (outlineType) {
    case 'character':
      return config.pipelineSkipCharacterOutlineReview;
    case 'character-traits':
      return config.pipelineSkipCharacterTraitsOutlineReview;
    case 'sensory':
      return config.pipelineSkipSensoryOutlineReview;
    default:
      return false;
  }
}

export function getOutlineState(
  session: ChapterPipelineSession,
  outlineType: ChapterPipelineOutlineType
): PipelineOutlineState | undefined {
  switch (outlineType) {
    case 'character':
      return session.characterOutline;
    case 'character-traits':
      return session.characterTraitsOutline;
    case 'sensory':
      return session.sensoryOutline;
    default:
      return undefined;
  }
}

export function setOutlineState(
  session: ChapterPipelineSession,
  outlineType: ChapterPipelineOutlineType,
  state: PipelineOutlineState
): void {
  switch (outlineType) {
    case 'character':
      session.characterOutline = state;
      break;
    case 'character-traits':
      session.characterTraitsOutline = state;
      break;
    case 'sensory':
      session.sensoryOutline = state;
      break;
    default:
      break;
  }
}

export function resolveOutlineGenerationTemplateKey(
  outlineType: ChapterPipelineOutlineType
): string {
  switch (outlineType) {
    case 'character':
      return CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY;
    case 'character-traits':
      return CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY;
    case 'sensory':
      return CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY;
    default:
      return CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY;
  }
}

export function resolveOutlineSourceText(
  session: ChapterPipelineSession,
  outlineType: ChapterPipelineOutlineType
): string {
  switch (outlineType) {
    case 'character':
      return getPipelineInputText(session, 1);
    case 'character-traits':
      return session.versions.afterCharacter ?? getPipelineInputText(session, 1);
    case 'sensory':
      return getPipelineInputText(session, 2);
    default:
      return session.versions.original;
  }
}

export function createEmptyOutlineState(userConfirmed = false): PipelineOutlineState {
  return {
    required: [],
    suggested: [],
    userConfirmed,
    revisionRound: 0,
    revisionHistory: [],
  };
}

export function pushOutlineRevisionHistory(state: PipelineOutlineState): void {
  const snapshot = {
    required: state.required.map((item) => ({ ...item })),
    suggested: state.suggested.map((item) => ({ ...item })),
  };
  const history = [...(state.revisionHistory ?? []), snapshot];
  state.revisionHistory = history.slice(-PIPELINE_OUTLINE_REVISION_HISTORY_LIMIT);
}

// ── Version chain ──────────────────────────────────────────────

export function getPipelineInputText(
  session: ChapterPipelineSession,
  module: ChapterPipelineModule
): string {
  switch (module) {
    case 1:
      return session.versions.original;
    case 2:
      return getPostCharacterText(session);
    case 3:
      return session.versions.afterSensory ?? getPostCharacterText(session);
    case 4:
      return (
        session.versions.afterRules ??
        session.versions.afterSensory ??
        getPostCharacterText(session)
      );
    default:
      return session.versions.original;
  }
}

export function resolvePipelineApplyText(
  session: ChapterPipelineSession,
  useVersion: 'afterRules' | 'final'
): string {
  if (useVersion === 'final' && session.versions.final) {
    return session.versions.final;
  }
  return (
    session.versions.final ??
    session.versions.afterRules ??
    session.versions.afterSensory ??
    session.versions.afterCharacterTraits ??
    session.versions.afterCharacter ??
    session.versions.original
  );
}

export function assertModulePrerequisites(
  session: ChapterPipelineSession,
  module: ChapterPipelineRunModule
): void {
  const enabled = session.config.pipelineEnabledModules;
  const traitsEnabled = shouldRunCharacterTraitsModule(session.config);

  if (module === 'character-outline') {
    if (!enabled.includes(1)) {
      throw new Error('模块一未启用');
    }
  }
  if (module === 'character') {
    if (!enabled.includes(1)) {
      throw new Error('模块一未启用');
    }
    const outline = session.characterOutline;
    if (!outline?.userConfirmed && !session.config.pipelineSkipCharacterOutlineReview) {
      throw new Error('角色调整大纲尚未确认');
    }
  }
  if (module === 'character-traits-outline' || module === 'character-traits') {
    if (!traitsEnabled) {
      throw new Error('角色特征润色未启用');
    }
    if (!session.versions.afterCharacter?.trim()) {
      throw new Error('请先完成模块一（角色调整）');
    }
  }
  if (module === 'character-traits') {
    const outline = session.characterTraitsOutline;
    if (!outline?.userConfirmed && !session.config.pipelineSkipCharacterTraitsOutlineReview) {
      throw new Error('角色特征润色大纲尚未确认');
    }
  }
  if (module === 'sensory-outline' || module === 'sensory-rewrite') {
    if (!enabled.includes(2)) {
      throw new Error('模块二未启用');
    }
    if (enabled.includes(1) && !session.versions.afterCharacter) {
      throw new Error('请先完成模块一（角色调整）');
    }
    if (traitsEnabled && !session.versions.afterCharacterTraits && !session.versions.afterCharacter) {
      throw new Error('请先完成角色特征润色');
    }
  }
  if (module === 'sensory-rewrite') {
    const outline = session.sensoryOutline;
    if (!outline?.userConfirmed && !session.config.pipelineSkipSensoryOutlineReview) {
      throw new Error('感官大纲尚未确认');
    }
  }
  if (module.startsWith('rules') && enabled.includes(3)) {
    const input = getPipelineInputText(session, 3);
    if (!input.trim()) {
      throw new Error('规则扫描输入正文为空');
    }
  }
  if (module.startsWith('homogenization') && enabled.includes(4)) {
    if (!session.versions.afterRules && enabled.includes(3)) {
      throw new Error('请先完成模块三（规则检查）');
    }
  }
}

// ── Protagonist context ──────────────────────────────────────

export interface PersonaChapterStateRef {
  chapterNo: number;
  appearance?: string;
  state?: string;
}

export interface PersonaRef {
  name: string;
  profile: string;
  chapterStates?: PersonaChapterStateRef[];
}

export function resolveProtagonistContext(
  chapterNo: number,
  rules: ProtagonistUnlockRule[],
  protagonist?: PersonaRef
): string {
  const lines: string[] = ['【当前章节进度】', `当前章节：第 ${chapterNo} 章`];
  if (protagonist) {
    lines.push(`主角：${protagonist.name}`);
    const latestState = protagonist.chapterStates
      ?.filter((s) => s.chapterNo < chapterNo)
      .sort((a, b) => b.chapterNo - a.chapterNo)[0];
    if (latestState) {
      lines.push(`最近状态（第 ${latestState.chapterNo} 章）：${latestState.state ?? ''}`);
      if (latestState.appearance) {
        lines.push(`外观：${latestState.appearance}`);
      }
    }
  }
  for (const rule of rules) {
    const unlocked =
      rule.unlockAtChapter !== undefined && chapterNo >= rule.unlockAtChapter;
    const status = unlocked ? '已解锁' : '未解锁';
    let line = `- ${rule.abilityKey}（${status}）：${rule.descriptionForPrompt}`;
    if (rule.unlockAfterCondition && !unlocked) {
      line += `；解锁条件：${rule.unlockAfterCondition}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ── Prompt builders ────────────────────────────────────────────

export function buildCharacterUserPrompt(input: {
  sourceText: string;
  protagonistContext: string;
  personaBlock: string;
  outline?: PipelineOutlineItem[];
}): string {
  const outlineBlock =
    input.outline && input.outline.length > 0
      ? `<character-outline>\n${JSON.stringify({ items: input.outline }, null, 2)}\n</character-outline>`
      : '';
  return [
    input.protagonistContext,
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    outlineBlock,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCharacterOutlineUserPrompt(input: {
  sourceText: string;
  protagonistContext: string;
  personaBlock: string;
}): string {
  return [
    input.protagonistContext,
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    [
      '【输出要求】',
      '- 每条 text 仅描述：待调整的对白/行为/互动问题与修改方向',
      '- 禁止输出可直接粘贴进正文的成品句子',
      CHAPTER_PIPELINE_CHARACTER_OUTLINE_JSON_FORMAT,
    ].join('\n'),
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCharacterTraitsOutlineUserPrompt(input: {
  sourceText: string;
  personaBlock: string;
}): string {
  return [
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    ['【输出要求】', CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_JSON_FORMAT].join('\n'),
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildCharacterTraitsRewriteUserPrompt(input: {
  sourceText: string;
  outline: PipelineOutlineItem[];
  personaBlock: string;
}): string {
  const outlineJson = JSON.stringify({ items: input.outline }, null, 2);
  return [
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    [
      '【改写原则】',
      '严格按大纲补缺角色卡特征；不改动情节骨架、对白、体位顺序。',
    ].join('\n'),
    `<character-traits-outline>\n${outlineJson}\n</character-traits-outline>`,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const PIPELINE_OUTLINE_JSON_OUTPUT_RULE = [
  '本步骤只输出一个 JSON 对象，不要任何前言、后语、Markdown 代码块、诊断报告或「以下是…」类说明。',
  '响应必须以 { 开头、以 } 结尾，不得输出报告式散文。',
  '结构：{"required":[{"id":"r1","text":"...","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
].join('\n');

export function buildOutlineGateRecheckUserPrompt(input: {
  baseUserPrompt: string;
  currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
  mode: ChapterPipelineOutlineReviseMode;
  revisionRound: number;
  userFeedback?: string;
}): string {
  void input.revisionRound;

  const blocks = [
    input.baseUserPrompt,
    `<current-outline>\n${JSON.stringify(input.currentOutline, null, 2)}\n</current-outline>`,
  ];

  if (input.userFeedback?.trim()) {
    blocks.push(`<user-feedback>\n${input.userFeedback.trim()}\n</user-feedback>`);
  }

  if (input.mode === 'recheck') {
    blocks.push(
      [
        '【补充说明】',
        '上文 <current-outline> 为上轮大纲，仅供参考对照。',
        '请按 system 中与首次生成完全相同的诊断步骤与判定标准重新执行。',
        '输出格式也与首次生成完全相同：仅输出 JSON 对象（required + suggested），不要前言、不要诊断报告、不要 Markdown。',
        '每条大纲项必须把定位/问题/修改方向写入 text 字段，禁止拆成 character、category、location、problem、fix 等字段。',
      ].join('\n')
    );
  } else {
    blocks.push(
      [
        '【补充说明】',
        '在保持与首次生成相同诊断流程与 JSON 输出格式的前提下，优先落实 <user-feedback>。',
        '仅输出 JSON 对象（required + suggested），不要前言、不要诊断报告、不要 Markdown。',
        '每条大纲项必须把定位/问题/修改方向写入 text 字段，禁止拆成 character、category、location、problem、fix 等字段。',
      ].join('\n')
    );
  }

  return blocks.filter(Boolean).join('\n\n');
}

export function buildSensoryOutlineUserPrompt(input: {
  sourceText: string;
  personaBlock: string;
}): string {
  return [
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    [
      '【输出要求】',
      '- 每条 text 仅描述：问题在哪、需加强什么感官维度、从什么角度切入',
      '- 禁止写出可直接用于正文的成品描写、比喻句、带引号的示例句',
      '- 禁止医学解剖词、零件级身体词、解释型说明句式',
      PIPELINE_OUTLINE_JSON_OUTPUT_RULE,
    ].join('\n'),
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSensoryRewriteUserPrompt(input: {
  sourceText: string;
  outline: PipelineOutlineItem[];
  personaBlock: string;
}): string {
  const outlineJson = JSON.stringify({ items: input.outline }, null, 2);
  return [
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    [
      '【改写原则】',
      '感官大纲每条 text 仅为方向指引，不是可照搬的成品句子。',
      '请根据方向自行创作描写，不得复制大纲中的具体短语或示例。',
    ].join('\n'),
    `<sensory-outline>\n${outlineJson}\n</sensory-outline>`,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildRulesScanUserPrompt(input: {
  sourceText: string;
  personaBlock: string;
}): string {
  return [
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function hashFingerprintPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export interface FinalPolishFingerprintInput {
  chapterContent: string;
  chapterUpdatedAt: string;
  personasFingerprint: string;
  systemPromptFingerprint: string;
  pipelineEngineFingerprint: string;
  contentSafetyRulesFingerprint: string;
  finalPolishConfigFingerprint: string;
  segmentConfigFingerprint: string;
}

export function computeFinalPolishFingerprint(input: FinalPolishFingerprintInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        chapterContent: input.chapterContent,
        chapterUpdatedAt: input.chapterUpdatedAt,
        personasFingerprint: input.personasFingerprint,
        systemPromptFingerprint: input.systemPromptFingerprint,
        pipelineEngineFingerprint: input.pipelineEngineFingerprint,
        contentSafetyRulesFingerprint: input.contentSafetyRulesFingerprint,
        finalPolishConfigFingerprint: input.finalPolishConfigFingerprint,
        segmentConfigFingerprint: input.segmentConfigFingerprint,
      })
    )
    .digest('hex');
}

export function computePersonasFingerprint(
  personas: Array<{
    id: string;
    name: string;
    profile: string;
    state: string;
    status: string;
    chapterStates?: Array<{ chapterNo: number; appearance?: string; state?: string }>;
  }>
): string {
  const payload = personas
    .filter((persona) => persona.status === 'published')
    .map((persona) => ({
      id: persona.id,
      name: persona.name,
      profile: persona.profile,
      state: persona.state,
      chapterStates: persona.chapterStates ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return hashFingerprintPart(JSON.stringify(payload));
}

export function computeContentSafetyRulesFingerprint(rules: ContentSafetyRule[]): string {
  const payload = rules
    .map((rule) => ({
      ruleId: rule.ruleId,
      pattern: rule.pattern,
      action: rule.action,
      severity: rule.severity,
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return hashFingerprintPart(JSON.stringify(payload));
}

export function resolveFinalPolishQualityStatus(
  residualIssues: PipelineRuleIssue[]
): FinalPolishQualityStatus {
  const unfixed = residualIssues.filter((issue) => !issue.fixed);
  if (unfixed.length === 0) {
    return 'passed';
  }
  const blocked = unfixed.some(
    (issue) =>
      issue.category === 'forbidden_word' ||
      issue.fixStrategy === 'manual' ||
      issue.fixStrategy === 'ai_segment'
  );
  if (blocked) {
    return 'blocked';
  }
  return 'passed_with_warnings';
}

export function buildRulesFixUserPrompt(input: {
  sourceText: string;
  issue: PipelineRuleIssue;
}): string {
  const span = resolveRuleIssueSpan(input.sourceText, input.issue);
  const startOffset = span?.start ?? input.issue.startOffset;
  const endOffset = span?.end ?? input.issue.endOffset;
  const contextStart = Math.max(0, startOffset - 200);
  const contextEnd = Math.min(input.sourceText.length, endOffset + 200);
  const excerpt = input.sourceText.slice(contextStart, contextEnd);
  const violation = input.sourceText.slice(startOffset, endOffset);
  const issuePayload = {
    ...input.issue,
    startOffset,
    endOffset,
  };
  return [
    `<rule-issue>\n${JSON.stringify(issuePayload, null, 2)}\n</rule-issue>`,
    `<context-excerpt>\n${excerpt}\n</context-excerpt>`,
    `<violation-text>\n${violation}\n</violation-text>`,
    '请仅输出修复后的 <context-excerpt> 段落（替换违规片段并保证衔接自然）。',
    '不要输出整章正文、不要 JSON、不要解释说明。',
  ].join('\n\n');
}

export function resolveRuleIssueSpan(
  text: string,
  issue: PipelineRuleIssue
): { start: number; end: number } | null {
  return resolveRuleIssueSpanStrict(text, issue);
}

/** 仅信任 offset 处精确匹配，禁止 indexOf 全局回退（避免误删大段） */
export function resolveRuleIssueSpanStrict(
  text: string,
  issue: PipelineRuleIssue
): { start: number; end: number } | null {
  const violation = issue.text?.trim();
  if (!violation) {
    return null;
  }

  const atOffset = text.slice(issue.startOffset, issue.endOffset);
  if (atOffset === violation) {
    return { start: issue.startOffset, end: issue.endOffset };
  }

  if (atOffset.includes(violation) && atOffset.length <= violation.length + 8) {
    const relative = atOffset.indexOf(violation);
    return {
      start: issue.startOffset + relative,
      end: issue.startOffset + relative + violation.length,
    };
  }

  return null;
}

export function isDeterministicRuleIssue(issue: PipelineRuleIssue): boolean {
  return issue.source !== 'llm';
}

export function shouldApplyAutoFix(
  issue: PipelineRuleIssue,
  mode: 'auto' | 'semi' | 'manual'
): boolean {
  if (mode === 'manual' || issue.fixStrategy !== 'auto') {
    return false;
  }
  if (!isDeterministicRuleIssue(issue)) {
    return false;
  }
  if (mode === 'semi') {
    if (issue.category === 'pronoun_mismatch') {
      return true;
    }
    if (issue.category === 'forbidden_word') {
      return Boolean(issue.replacement?.trim());
    }
    return false;
  }
  if (issue.category === 'forbidden_word') {
    return Boolean(issue.replacement?.trim());
  }
  return true;
}

export function shouldApplyAiSegmentFix(
  issue: PipelineRuleIssue,
  mode: 'auto' | 'semi' | 'manual'
): boolean {
  if (mode === 'manual' || issue.fixStrategy !== 'ai_segment') {
    return false;
  }
  if (!isDeterministicRuleIssue(issue)) {
    return false;
  }
  if (
    mode === 'semi' &&
    issue.category === 'forbidden_word' &&
    issue.contentSafetyAction === 'rewrite_sentence'
  ) {
    return true;
  }
  return mode === 'auto';
}

export function relocateRuleIssuesInText(
  text: string,
  issues: PipelineRuleIssue[]
): PipelineRuleIssue[] {
  return issues.map((issue) => {
    if (issue.fixed) {
      return issue;
    }
    const span = resolveRuleIssueSpanStrict(text, issue);
    if (!span) {
      return issue;
    }
    return {
      ...issue,
      startOffset: span.start,
      endOffset: span.end,
      text: text.slice(span.start, span.end),
      context: text.slice(Math.max(0, span.start - 30), Math.min(text.length, span.end + 30)),
    };
  });
}

export function downgradeUnsafeAutoFixStrategy(issue: PipelineRuleIssue): PipelineFixStrategy {
  if (issue.source === 'llm') {
    return 'manual';
  }
  if (issue.fixStrategy !== 'auto') {
    return issue.fixStrategy;
  }
  const spanLen = Math.max(0, issue.endOffset - issue.startOffset);
  const maxSpan = MAX_AUTO_FIX_SPAN_BY_CATEGORY[issue.category] ?? 80;
  if (spanLen > maxSpan) {
    return 'manual';
  }
  return 'auto';
}

/**
 * 校验 issue 在正文中的位置，过滤 LLM 幻觉 offset；过长的 auto 项降级为 manual。
 */
export function sanitizeRuleIssuesForText(
  text: string,
  issues: PipelineRuleIssue[]
): PipelineRuleIssue[] {
  const sanitized: PipelineRuleIssue[] = [];
  for (const issue of issues) {
    const span = resolveRuleIssueSpanStrict(text, issue);
    if (!span) {
      continue;
    }
    const relocated: PipelineRuleIssue = {
      ...issue,
      startOffset: span.start,
      endOffset: span.end,
      text: text.slice(span.start, span.end),
      context: text.slice(Math.max(0, span.start - 30), Math.min(text.length, span.end + 30)),
      fixStrategy: downgradeUnsafeAutoFixStrategy({
        ...issue,
        startOffset: span.start,
        endOffset: span.end,
      }),
    };
    sanitized.push(relocated);
  }
  return dedupeRuleIssuesBySpan(sanitized);
}

function dedupeRuleIssuesBySpan(issues: PipelineRuleIssue[]): PipelineRuleIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}:${issue.startOffset}:${issue.endOffset}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function normalizeRuleFixOutput(
  fixOutput: string,
  issue: PipelineRuleIssue,
  sourceTextLength: number
): string {
  const cleaned = fixOutput
    .trim()
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) {
    return '';
  }
  if (
    cleaned.length > Math.max(4000, Math.floor(sourceTextLength * 0.6)) ||
    cleaned.includes('<chapter-original>') ||
    cleaned.includes('<rule-issue>')
  ) {
    return '';
  }
  if (issue.text && cleaned === issue.text) {
    return '';
  }
  return cleaned;
}

export function applyRuleSegmentFix(
  text: string,
  issue: PipelineRuleIssue,
  fixOutput: string
): { text: string; applied: boolean } {
  const span = resolveRuleIssueSpanStrict(text, issue);
  if (!span) {
    return { text, applied: false };
  }

  const normalized = normalizeRuleFixOutput(fixOutput, issue, text.length);
  if (!normalized) {
    return { text, applied: false };
  }

  const violation = text.slice(span.start, span.end);
  if (normalized === violation) {
    return { text, applied: false };
  }

  if (normalized.length > MAX_AI_SEGMENT_REPLACEMENT_CHARS) {
    return { text, applied: false };
  }

  // 仅替换违规片段本身，避免 ±200 字窗口替换导致整段消失
  return {
    text: text.slice(0, span.start) + normalized + text.slice(span.end),
    applied: true,
  };
}

export function buildHomogenizationScanUserPrompt(input: {
  sourceText: string;
  priorExcerpts: Array<{ chapterNo: number; excerpt: string }>;
}): string {
  const priorBlock = input.priorExcerpts
    .map((p) => `【第 ${p.chapterNo} 章摘录】\n${p.excerpt}`)
    .join('\n\n');
  return [priorBlock, `<chapter-original>\n${input.sourceText}\n</chapter-original>`]
    .filter(Boolean)
    .join('\n\n');
}

export function buildHomogenizationRewriteUserPrompt(input: {
  sourceText: string;
  report: PipelineHomogenizationIssue[];
}): string {
  return [
    `<homogenization-report>\n${JSON.stringify(input.report, null, 2)}\n</homogenization-report>`,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ].join('\n\n');
}

// ── JSON parsers ───────────────────────────────────────────────

export function scanOutlineItemContentWarnings(
  text: string,
  rules: ContentSafetyRule[],
  scanEnabled: boolean
): string[] {
  if (!scanEnabled || !text.trim()) {
    return [];
  }
  const result = scanContentSafety(text, rules);
  const words = new Set<string>();
  for (const hit of result.hits) {
    const matched = hit.matchedText?.trim();
    if (matched) {
      words.add(matched);
    }
  }
  return [...words].map((word) => `禁用词：${word}`);
}

export function sanitizeSensoryOutlineWithContentScan(
  outline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] },
  rules: ContentSafetyRule[],
  scanEnabled: boolean
): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  const annotate = (item: PipelineOutlineItem): PipelineOutlineItem => {
    const contentWarnings = scanOutlineItemContentWarnings(item.text, rules, scanEnabled);
    if (!contentWarnings.length) {
      return item;
    }
    return { ...item, contentWarnings };
  };

  const required: PipelineOutlineItem[] = [];
  const demoted: PipelineOutlineItem[] = [];
  for (const item of outline.required.map(annotate)) {
    if (item.contentWarnings?.length) {
      demoted.push({ ...item, priority: 'suggested' });
    } else {
      required.push(item);
    }
  }

  return {
    required,
    suggested: [...demoted, ...outline.suggested.map(annotate)],
  };
}

export function parseSensoryOutlineJson(raw: string): {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
} {
  return parsePipelineOutlineJson(raw);
}

const PIPELINE_OUTLINE_ALT_ARRAY_KEYS = [
  'character_adjustments',
  'character_traits_adjustments',
  'trait_adjustments',
  'missing_features',
  'adjustments',
  'items',
  'issues',
  'diagnostics',
  'findings',
] as const;

function pickOutlineStringField(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** 将模型偶发输出的诊断分字段形态归一为 PipelineOutlineItem 可解析结构 */
export function normalizePipelineOutlineItemPartial(
  item: Partial<PipelineOutlineItem> & Record<string, unknown>
): Partial<PipelineOutlineItem> {
  if (item.text?.trim()) {
    return item;
  }

  const character = pickOutlineStringField(item, ['character', 'persona', 'role', 'name']);
  const category = pickOutlineStringField(item, [
    'category',
    'issueType',
    'type',
    'problemType',
  ]);
  const location = pickOutlineStringField(item, ['location', 'anchor', 'position', 'loc']);
  const problem = pickOutlineStringField(item, [
    'problem',
    'issue',
    'description',
    'conflict',
  ]);
  const fix = pickOutlineStringField(item, [
    'fix',
    'direction',
    'suggestion',
    'revision',
    'fixDirection',
  ]);

  const hasDiagnosticShape = Boolean(character || category || location || problem || fix);
  if (!hasDiagnosticShape) {
    return item;
  }

  const displayName = character ?? pickOutlineStringField(item, ['personaName']);
  const prefix =
    displayName && category
      ? `【${displayName}-${category}】`
      : displayName
        ? `【${displayName}】`
        : category
          ? `【${category}】`
          : '';
  const textParts = [prefix, location, problem, fix ? `修改方向：${fix}` : ''].filter(Boolean);
  const text = textParts.join(' ').replace(/\s+/g, ' ').trim();

  return {
    ...item,
    text,
    personaName: item.personaName?.trim() || displayName,
    anchorHint: item.anchorHint?.trim() || location,
    featureRef: item.featureRef?.trim() || category,
  };
}

function resolveOutlineItemPriority(item: {
  priority?: unknown;
  anchorHint?: string;
}): 'required' | 'suggested' {
  const raw = item.priority;
  if (raw === 'suggested' || raw === 'required') {
    return raw;
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'suggested' || normalized === 'optional' || normalized === '建议') {
      return 'suggested';
    }
  }
  const hint = item.anchorHint?.trim() ?? '';
  if (
    /标记为[「"']?suggested/i.test(hint) ||
    /^suggested[：:]/i.test(hint) ||
    /[「"']suggested[：:]/i.test(hint)
  ) {
    return 'suggested';
  }
  return 'required';
}

/** 模型未填 text 时，由 personaName / featureRef / anchorHint 拼出展示与改写用文案 */
export function synthesizePipelineOutlineItemText(item: Partial<PipelineOutlineItem>): string {
  const direct = item.text?.trim();
  if (direct) {
    return direct;
  }
  const normalized = normalizePipelineOutlineItemPartial(
    item as Partial<PipelineOutlineItem> & Record<string, unknown>
  );
  if (normalized.text?.trim()) {
    return normalized.text.trim();
  }
  const parts: string[] = [];
  if (item.personaName?.trim()) {
    parts.push(`【${item.personaName.trim()}】`);
  }
  if (item.featureRef?.trim()) {
    parts.push(`缺失特征：${item.featureRef.trim()}`);
  }
  if (item.anchorHint?.trim()) {
    parts.push(`建议插入：${item.anchorHint.trim()}`);
  }
  return parts.join(' ').trim();
}

function pushOutlineItemPartial(
  item: unknown,
  required: Array<Partial<PipelineOutlineItem>>,
  suggested: Array<Partial<PipelineOutlineItem>>
): void {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return;
  }
  const partial = normalizePipelineOutlineItemPartial(
    item as Partial<PipelineOutlineItem> & Record<string, unknown>
  );
  if (resolveOutlineItemPriority(partial) === 'suggested') {
    suggested.push({ ...partial, priority: 'suggested' });
  } else {
    required.push(partial);
  }
}

function collectOutlineItemPartials(parsed: Record<string, unknown>): {
  required: Array<Partial<PipelineOutlineItem>>;
  suggested: Array<Partial<PipelineOutlineItem>>;
} {
  const required: Array<Partial<PipelineOutlineItem>> = [];
  const suggested: Array<Partial<PipelineOutlineItem>> = [];

  for (const entry of (parsed.required as unknown[]) ?? []) {
    pushOutlineItemPartial(entry, required, suggested);
  }
  for (const entry of (parsed.suggested as unknown[]) ?? []) {
    const partial = entry as Partial<PipelineOutlineItem>;
    suggested.push({ ...partial, priority: 'suggested' });
  }

  if (required.length > 0 || suggested.length > 0) {
    return { required, suggested };
  }

  for (const key of PIPELINE_OUTLINE_ALT_ARRAY_KEYS) {
    const entries = parsed[key];
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    for (const entry of entries) {
      pushOutlineItemPartial(entry, required, suggested);
    }
    break;
  }

  return { required, suggested };
}

function collectOutlineItemPartialsFromRoot(parsed: unknown): {
  required: Array<Partial<PipelineOutlineItem>>;
  suggested: Array<Partial<PipelineOutlineItem>>;
} {
  if (Array.isArray(parsed)) {
    const required: Array<Partial<PipelineOutlineItem>> = [];
    const suggested: Array<Partial<PipelineOutlineItem>> = [];
    for (const entry of parsed) {
      pushOutlineItemPartial(entry, required, suggested);
    }
    return { required, suggested };
  }
  if (parsed && typeof parsed === 'object') {
    return collectOutlineItemPartials(parsed as Record<string, unknown>);
  }
  return { required: [], suggested: [] };
}

export function stripPipelineOutlineJsonFence(raw: string): string {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  const withoutEdgeFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  if (withoutEdgeFence.startsWith('{')) {
    const balanced = extractBalancedJsonObject(withoutEdgeFence, 0);
    if (balanced) {
      return balanced;
    }
  }

  const firstBrace = trimmed.indexOf('{');
  if (firstBrace >= 0) {
    const balanced = extractBalancedJsonObject(trimmed, firstBrace);
    if (balanced) {
      try {
        JSON.parse(balanced);
        return balanced;
      } catch {
        // fall through to trimmed text
      }
    }
  }

  return withoutEdgeFence;
}

function extractBalancedJsonObject(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function mapPipelineOutlineItem(
  item: Partial<PipelineOutlineItem>,
  priority: 'required' | 'suggested',
  index: number
): PipelineOutlineItem | null {
  const text = synthesizePipelineOutlineItemText(item);
  if (!text) {
    return null;
  }
  return {
    id: item.id?.trim() || `${priority}-${index + 1}`,
    text,
    priority,
    ...(item.contentWarnings?.length ? { contentWarnings: [...item.contentWarnings] } : {}),
    ...(item.personaId ? { personaId: item.personaId } : {}),
    ...(item.personaName?.trim() ? { personaName: item.personaName.trim() } : {}),
    ...(item.featureRef?.trim() ? { featureRef: item.featureRef.trim() } : {}),
    ...(item.anchorHint?.trim() ? { anchorHint: item.anchorHint.trim() } : {}),
  };
}

export function parsePipelineOutlineJson(raw: string): {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
} {
  const cleaned = stripPipelineOutlineJsonFence(raw);
  const parsed: unknown = JSON.parse(cleaned);
  const collected = collectOutlineItemPartialsFromRoot(parsed);

  const required = collected.required
    .map((item, index) => mapPipelineOutlineItem(item, 'required', index))
    .filter((item): item is PipelineOutlineItem => item !== null);
  const suggested = collected.suggested
    .map((item, index) => mapPipelineOutlineItem(item, 'suggested', index))
    .filter((item): item is PipelineOutlineItem => item !== null);

  return { required, suggested };
}

export function parseRuleIssuesJson(raw: string): PipelineRuleIssue[] {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as {
    issues?: Array<Partial<PipelineRuleIssue>>;
  };
  return (parsed.issues ?? []).map((item, index) => ({
    id: item.id?.trim() || `issue-${index + 1}`,
    category: (item.category as PipelineRuleCategory) || 'explanatory_text',
    text: item.text?.trim() || '',
    context: item.context?.trim() || '',
    fixStrategy: (item.fixStrategy as PipelineFixStrategy) || 'manual',
    startOffset: typeof item.startOffset === 'number' ? item.startOffset : 0,
    endOffset: typeof item.endOffset === 'number' ? item.endOffset : 0,
    fixed: false,
    source: 'llm' as const,
  }));
}

export function parseHomogenizationReportJson(raw: string): PipelineHomogenizationIssue[] {
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as {
    issues?: Array<Partial<PipelineHomogenizationIssue>>;
  };
  return (parsed.issues ?? []).map((item, index) => ({
    id: item.id?.trim() || `homo-${index + 1}`,
    text: item.text?.trim() || '',
    priorChapterNo: typeof item.priorChapterNo === 'number' ? item.priorChapterNo : 0,
    suggestion: item.suggestion?.trim() || '',
  }));
}

// ── Segmentation ───────────────────────────────────────────────

export function resolvePipelineSegmentStrategy(
  textLength: number,
  segmentCharSize: number
): { mode: 'single' | 'segmented'; segmentCount: number; strategyLabel: string } {
  const config = resolveChapterOptimizeConfigWithProjectOverride(segmentCharSize);
  const strategy = resolveChapterOptimizeLengthStrategy(textLength, config);
  return {
    mode: strategy.mode,
    segmentCount: strategy.segmentCount,
    strategyLabel: strategy.strategyLabel,
  };
}

export function splitPipelineText(text: string, segmentCharSize: number): string[] {
  const config = resolveChapterOptimizeConfigWithProjectOverride(segmentCharSize);
  const strategy = resolveChapterOptimizeLengthStrategy(text.length, config);
  if (strategy.mode === 'single' || strategy.segmentCount <= 1) {
    return [text];
  }
  const segments = splitIntoSegments(text, '', strategy.segmentCount);
  return segments.map((segment) => segment.originalText);
}

export function makePipelineSessionId(): string {
  return `pipeline-${randomUUID()}`;
}

export function makePipelineTraceId(module: string): string {
  return `pipeline-${module}-${randomUUID().slice(0, 8)}`;
}

export function formatPipelineStageLabel(stage: ChapterPipelineStage): string {
  const labels: Record<ChapterPipelineStage, string> = {
    pipeline_character_outline: '生成角色调整大纲…',
    pipeline_character: '角色调整中…',
    pipeline_character_traits_outline: '生成角色特征润色大纲…',
    pipeline_character_traits: '角色特征润色中…',
    pipeline_sensory_outline: '生成感官优化大纲…',
    pipeline_sensory_rewrite: '感官优化改写中…',
    pipeline_rules_scan: '规则扫描中…',
    pipeline_rules_fix: '规则修复中…',
    pipeline_homogenization_scan: '同质化检测中…',
    pipeline_homogenization_rewrite: '同质化改写中…',
    pipeline_final_polish_done: '终稿已生成，等待审核',
    compliance_outline: '生成合规大纲…',
    compliance_rewrite: '合规改写中…',
    compliance_rewrite_segment: '合规改写分段中…',
    compliance_rescan: '硬规则复扫中…',
    draft_segment: '分段生成中…',
    merge_validation: '合并校验中…',
  };
  return labels[stage] ?? stage;
}
