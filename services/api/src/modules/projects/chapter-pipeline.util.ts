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
export const CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY = 'chapter.pipeline.sensory.outline';
export const CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY = 'chapter.pipeline.sensory.rewrite';
export const CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY = 'chapter.pipeline.rules.scan';
export const CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY = 'chapter.pipeline.rules.fix';
export const CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY =
  'chapter.pipeline.homogenization.scan';
export const CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY =
  'chapter.pipeline.homogenization.rewrite';

export const CHAPTER_PIPELINE_TEMPLATE_KEYS = [
  CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY,
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
  'ONLY：校对话风格、行为反应、人物互动方式、情感表达是否符合人物卡与章节进度。',
  '禁止：修改感官描写密度与质量、禁用词与叙事规则、解释型说明、跨章写法。',
  '直接输出改写后的完整章节正文，不要输出方案、说明或 Markdown。',
  '必须以下文 <chapter-original> 为蓝本；输出语言、人称、人物名称与原文保持一致。',
].join('\n');

export const CHAPTER_PIPELINE_SENSORY_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深小说编辑，正在对章节正文制定「感官优化大纲」。',
  DIMENSION_BOUNDARY,
  'ONLY：分析性爱/亲密场景的感官描写质量，列出需加强或调整的感官要点。',
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
  | 'character'
  | 'sensory-outline'
  | 'sensory-rewrite'
  | 'rules-scan'
  | 'rules-fix'
  | 'homogenization'
  | 'homogenization-scan'
  | 'homogenization-rewrite'
  | 'run-all'
  | 'final-polish';

export type ChapterPipelineStage =
  | 'pipeline_character'
  | 'pipeline_sensory_outline'
  | 'pipeline_sensory_rewrite'
  | 'pipeline_rules_scan'
  | 'pipeline_rules_fix'
  | 'pipeline_homogenization_scan'
  | 'pipeline_homogenization_rewrite'
  | 'pipeline_final_polish_done'
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
}

export interface PipelineHomogenizationIssue {
  id: string;
  text: string;
  priorChapterNo: number;
  suggestion: string;
}

export interface ChapterPipelineVersions {
  original: string;
  afterCharacter?: string;
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
  sensoryOutline?: {
    required: PipelineOutlineItem[];
    suggested: PipelineOutlineItem[];
    userConfirmed: boolean;
  };
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
  pipelineRulesFixMode: 'semi',
  pipelineHomogenizationEnabled: false,
  pipelineHomogenizationPriorChapterCount: 3,
  pipelineEnabledModules: [1, 2, 3],
};

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

// ── Version chain ──────────────────────────────────────────────

export function getPipelineInputText(
  session: ChapterPipelineSession,
  module: ChapterPipelineModule
): string {
  switch (module) {
    case 1:
      return session.versions.original;
    case 2:
      return session.versions.afterCharacter ?? session.versions.original;
    case 3:
      return session.versions.afterSensory ?? session.versions.afterCharacter ?? session.versions.original;
    case 4:
      return (
        session.versions.afterRules ??
        session.versions.afterSensory ??
        session.versions.afterCharacter ??
        session.versions.original
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
    session.versions.afterCharacter ??
    session.versions.original
  );
}

export function assertModulePrerequisites(
  session: ChapterPipelineSession,
  module: ChapterPipelineRunModule
): void {
  const enabled = session.config.pipelineEnabledModules;
  if (module === 'sensory-outline' || module === 'sensory-rewrite') {
    if (!enabled.includes(2)) {
      throw new Error('模块二未启用');
    }
    if (enabled.includes(1) && !session.versions.afterCharacter) {
      throw new Error('请先完成模块一（角色调整）');
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
}): string {
  return [
    input.protagonistContext,
    input.personaBlock ? `【人物卡】\n${input.personaBlock}` : '',
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`,
  ]
    .filter(Boolean)
    .join('\n\n');
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
    return issue.category === 'pronoun_mismatch' || issue.category === 'forbidden_word';
  }
  return true;
}

export function shouldApplyAiSegmentFix(
  issue: PipelineRuleIssue,
  mode: 'auto' | 'semi' | 'manual'
): boolean {
  if (mode !== 'auto' || issue.fixStrategy !== 'ai_segment') {
    return false;
  }
  return isDeterministicRuleIssue(issue);
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
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned) as {
    required?: Array<{ id?: string; text?: string; priority?: string }>;
    suggested?: Array<{ id?: string; text?: string; priority?: string }>;
  };
  const mapItem = (
    item: { id?: string; text?: string; priority?: string },
    priority: 'required' | 'suggested',
    index: number
  ): PipelineOutlineItem => ({
    id: item.id?.trim() || `${priority}-${index + 1}`,
    text: item.text?.trim() || '',
    priority,
  });
  return {
    required: (parsed.required ?? []).map((item, i) => mapItem(item, 'required', i)),
    suggested: (parsed.suggested ?? []).map((item, i) => mapItem(item, 'suggested', i)),
  };
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
    pipeline_character: '角色调整中…',
    pipeline_sensory_outline: '生成感官优化大纲…',
    pipeline_sensory_rewrite: '感官优化改写中…',
    pipeline_rules_scan: '规则扫描中…',
    pipeline_rules_fix: '规则修复中…',
    pipeline_homogenization_scan: '同质化检测中…',
    pipeline_homogenization_rewrite: '同质化改写中…',
    pipeline_final_polish_done: '终稿已生成，等待审核',
    draft_segment: '分段生成中…',
    merge_validation: '合并校验中…',
  };
  return labels[stage] ?? stage;
}
