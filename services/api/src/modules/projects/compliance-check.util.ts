/**
 * 终稿合规检验工具（AQ-297~301）
 */

import { randomUUID } from 'node:crypto';
import type { ContentSafetyRule } from '@aether-quill/config';
import {
  PIPELINE_OUTLINE_JSON_OUTPUT_RULE,
  filterPipelinePersonas,
  type FinalPolishQualityStatus,
  type PipelineOutlineItem,
  type PipelineRuleIssue,
} from './chapter-pipeline.util';

export const CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY = 'chapter.compliance.outline';
export const CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY = 'chapter.compliance.rewrite';
export const CHAPTER_COMPLIANCE_COVERAGE_VERIFY_TEMPLATE_KEY = 'chapter.compliance.coverage.verify';
export const CHAPTER_COMPLIANCE_REWRITE_FIX_ITEMS_TEMPLATE_KEY = 'chapter.compliance.rewrite.fix-items';

export const CHAPTER_COMPLIANCE_TEMPLATE_KEYS = [
  CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_COVERAGE_VERIFY_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_REWRITE_FIX_ITEMS_TEMPLATE_KEY,
] as const;

export const COMPLIANCE_ERROR = {
  sessionNotFound: 1332,
  outlineNotConfirmed: 1333,
  qualityBlocked: 1334,
  unsupportedTemplate: 1335,
} as const;

export type ComplianceCheckStatus =
  | 'outline_pending'
  | 'outline_ready'
  | 'rewriting'
  | 'review'
  | 'applied'
  | 'cancelled';

export type ComplianceOutlineReviseMode = 'recheck' | 'revise';

export interface ComplianceOutlineState {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  userConfirmed: boolean;
  revisionRound: number;
  revisionHistory?: Array<{ required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] }>;
  confirmedAt?: string;
}

export interface ComplianceCheckSession {
  sessionId: string;
  projectId: string;
  chapterNo: number;
  status: ComplianceCheckStatus;
  sourceText: string;
  /** 复用本章最近一次创作精修检索预览确认的角色名；无则合规阶段回退全部已发布人物 */
  selectedPersonaNames?: string[];
  outline?: ComplianceOutlineState;
  versionText?: string;
  preScanIssues?: PipelineRuleIssue[];
  residualIssues?: PipelineRuleIssue[];
  qualityStatus?: FinalPolishQualityStatus;
  traceIds: { outline?: string; rewrite?: string; rescan?: string; preScan?: string };
  createdAt: Date;
  updatedAt: Date;
}

export const COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS = 2000;

export const CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深内容合规编辑，正在对小说章节正文做「发布前合规检验」并输出修改计划。',
  'ONLY：识别合规风险与必要修改项，输出 JSON 大纲；禁止输出改写后正文、禁止 Markdown 代码块。',
  '合规范围：平台禁用表达、项目自定义禁用词、擦边表述、明显违规描写；不得借机改写剧情或文风。',
  '若提供【人物卡参考】：须核对正文与人设、称谓、关系、外观描述是否一致；不一致项写入大纲（category 可用 consistency）。',
  '保持原文人称、叙事视角与核心情节不变；修改计划须可定位到具体片段。',
  PIPELINE_OUTLINE_JSON_OUTPUT_RULE,
  'category 建议取值：forbidden_expression | platform_rule | consistency | other（写入 text 即可，勿拆字段）。',
].join('\n');

export const CHAPTER_COMPLIANCE_REWRITE_SYSTEM_PROMPT = [
  '你是一位资深内容合规编辑，正在按已确认的合规大纲修改章节正文。',
  'ONLY：落实大纲中的合规修改项；禁止扩写剧情、新增设定/人物、改变因果顺序。',
  '若提供【人物卡参考】：改写时保持与人设一致，仅修正大纲标注的合规/一致性问题。',
  '保持原文人称、语气与叙事风格；只改合规问题相关片段。',
  '直接输出完整正文，不要 JSON、不要说明或 Markdown。',
].join('\n');

const COMPLIANCE_OUTLINE_JSON_FORMAT = [
  '输出 JSON：{"required":[{"id":"r1","text":"...","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
  '每条 text 须含：问题定位 + 违规/风险说明 + 修改方向。',
].join('\n');

export function makeComplianceTraceId(suffix: string): string {
  return `compliance-${suffix}-${randomUUID().slice(0, 8)}`;
}

export function buildForbiddenWordsSummary(rules: ContentSafetyRule[]): string {
  const patterns = rules
    .filter((rule) => rule.severity === 'high' || rule.action === 'block')
    .map((rule) => rule.pattern)
    .filter(Boolean)
    .slice(0, 80);
  if (!patterns.length) {
    return '（无项目级高危禁用词配置）';
  }
  return patterns.join('、');
}

export function buildCompliancePreScanSummary(issues: PipelineRuleIssue[]): string {
  if (!issues.length) {
    return '（预扫未发现硬规则命中）';
  }
  return issues
    .slice(0, 50)
    .map((issue) => `- [${issue.category}] ${issue.text}（${issue.fixStrategy}）`)
    .join('\n');
}

export function buildCompliancePersonaBlock(
  personas: Array<{ name: string; profile: string; state: string; status: string }>,
  selectedPersonaNames?: string[]
): string {
  return filterPipelinePersonas(personas, selectedPersonaNames)
    .map((persona) => `${persona.name}：${persona.profile}\n状态：${persona.state}`)
    .join('\n\n');
}

export function buildComplianceOutlineUserPrompt(input: {
  sourceText: string;
  forbiddenWordsSummary: string;
  preScanSummary?: string;
  personaBlock?: string;
}): string {
  const blocks = [
    '【输出要求】',
    COMPLIANCE_OUTLINE_JSON_FORMAT,
    `【项目高危禁用词参考】\n${input.forbiddenWordsSummary}`,
  ];
  if (input.personaBlock?.trim()) {
    blocks.push(
      [
        '【人物卡参考】',
        input.personaBlock.trim(),
        '（须核对正文与人设、称谓、关系是否一致；不一致写入大纲 consistency 类项）',
      ].join('\n')
    );
  }
  if (input.preScanSummary?.trim()) {
    blocks.push(`【硬规则预扫命中摘要】\n${input.preScanSummary.trim()}`);
  }
  blocks.push(`<chapter-original>\n${input.sourceText}\n</chapter-original>`);
  return blocks.join('\n\n');
}

export function buildComplianceRewriteUserPrompt(input: {
  sourceText: string;
  outline: PipelineOutlineItem[];
  forbiddenWordsSummary: string;
  personaBlock?: string;
}): string {
  const outlineJson = JSON.stringify({ items: input.outline }, null, 2);
  const blocks = [`【项目高危禁用词参考】\n${input.forbiddenWordsSummary}`];
  if (input.personaBlock?.trim()) {
    blocks.push(`【人物卡参考】\n${input.personaBlock.trim()}`);
  }
  blocks.push(
    `<compliance-outline>\n${outlineJson}\n</compliance-outline>`,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`
  );
  return blocks.join('\n\n');
}

export function buildComplianceOutlineGateUserPrompt(input: {
  baseUserPrompt: string;
  currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
  mode: ComplianceOutlineReviseMode;
  userFeedback?: string;
}): string {
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
        '请按 system 中与首次生成相同的标准重新检验正文并输出 JSON 大纲。',
        '仅输出 JSON（required + suggested），不要前言或报告体。',
      ].join('\n')
    );
  } else {
    blocks.push(
      [
        '【补充说明】',
        '在保持相同 JSON 格式前提下，优先落实 <user-feedback>。',
        '仅输出 JSON（required + suggested）。',
      ].join('\n')
    );
  }
  return blocks.filter(Boolean).join('\n\n');
}

export function createEmptyComplianceOutlineState(): ComplianceOutlineState {
  return {
    required: [],
    suggested: [],
    userConfirmed: false,
    revisionRound: 0,
    revisionHistory: [],
  };
}

export function serializeComplianceSessionView(session: ComplianceCheckSession) {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    chapterNo: session.chapterNo,
    status: session.status,
    sourceText: session.sourceText,
    selectedPersonaNames: session.selectedPersonaNames,
    outline: session.outline,
    versionText: session.versionText,
    preScanIssues: session.preScanIssues,
    residualIssues: session.residualIssues,
    qualityStatus: session.qualityStatus,
    traceIds: session.traceIds,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export const COMPLIANCE_GENERATION_CONTEXT = {
  omitProjectSystemPrompt: true,
} as const;
