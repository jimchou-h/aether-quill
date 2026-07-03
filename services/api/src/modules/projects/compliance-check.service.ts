/**
 * 终稿合规检验服务（AQ-299）
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mergeContentSafetyRules } from '@aether-quill/config';
import { randomUUID } from 'node:crypto';
import { streamPipelineGeneration } from './chapter-pipeline-orchestrator.client';
import {
  applyRuleSegmentFix,
  buildRulesFixUserPrompt,
  CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
  parsePipelineOutlineJson,
  PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS,
  relocateRuleIssuesInText,
  resolveFinalPolishQualityStatus,
  resolvePipelineSegmentStrategy,
  sanitizeRuleIssuesForText,
  sanitizeSensoryOutlineWithContentScan,
  shouldApplyAiSegmentFix,
  splitPipelineText,
  type PipelineOutlineItem,
} from './chapter-pipeline.util';
import type { PipelineStreamCallbacks } from './chapter-pipeline.service';
import {
  applyAutoFixes,
  scanPipelineRules,
} from './chapter-pipeline-rule-classifier';
import { mergeSegmentDraftTexts } from './chapter-optimize.util';
import { findLatestPipelineSessionForChapter } from './chapter-pipeline-session.store';
import {
  findActiveComplianceSession,
  getComplianceSession,
  putComplianceSession,
} from './compliance-check-session.store';
import {
  buildComplianceOutlineGateUserPrompt,
  buildComplianceOutlineUserPrompt,
  buildCompliancePersonaBlock,
  buildCompliancePreScanSummary,
  buildComplianceRewriteUserPrompt,
  buildForbiddenWordsSummary,
  CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY,
  COMPLIANCE_ERROR,
  COMPLIANCE_GENERATION_CONTEXT,
  COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS,
  createEmptyComplianceOutlineState,
  makeComplianceTraceId,
  type ComplianceCheckSession,
  type ComplianceOutlineReviseMode,
  type ComplianceOutlineState,
} from './compliance-check.util';
import { ProjectsService } from './projects.service';

const COMPLIANCE_RULE_FIX_MAX_TOKENS = 2048;

export class ComplianceCheckSessionNotFoundError extends Error {
  readonly code = COMPLIANCE_ERROR.sessionNotFound;
}

export class ComplianceCheckOutlineNotConfirmedError extends Error {
  readonly code = COMPLIANCE_ERROR.outlineNotConfirmed;
}

export class ComplianceCheckQualityBlockedError extends Error {
  readonly code = COMPLIANCE_ERROR.qualityBlocked;
}

export class ComplianceCheckOutlineReviseInvalidError extends Error {
  readonly code = COMPLIANCE_ERROR.outlineNotConfirmed;
}

@Injectable()
export class ComplianceCheckService {
  constructor(private readonly projectsService: ProjectsService) {}

  private async generateComplianceOutlineViaStream(input: {
    projectId: string;
    prompt: string;
    traceId: string;
    chapterNo: number;
    mode?: ComplianceOutlineReviseMode;
  }): Promise<string> {
    const result = await streamPipelineGeneration({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: input.projectId,
      prompt: input.prompt,
      templateKey: CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY,
      context: {
        ...COMPLIANCE_GENERATION_CONTEXT,
        task: input.mode
          ? `chapter.compliance.outline.${input.mode}`
          : 'chapter.compliance.outline',
        chapterNo: input.chapterNo,
        traceId: input.traceId,
        ...(input.mode ? { mode: input.mode } : {}),
      },
      callbacks: {},
    });
    if (!result.ok) {
      throw new BadRequestException(result.errorMessage || '合规大纲生成失败');
    }
    return result.text;
  }

  startSession(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.projectsService.getSettings(projectId, userId);
    }
    const chapter = this.projectsService.getChapterRecordForPipeline(projectId, chapterNo);
    if (!chapter?.content?.trim()) {
      throw new BadRequestException(`第${chapterNo}章正文为空，无法启动合规检验`);
    }

    const pipelineSession = findLatestPipelineSessionForChapter(projectId, chapterNo);
    const selectedPersonaNames = pipelineSession?.selectedPersonaNames
      ?.map((name) => name.trim())
      .filter((name) => name.length > 0);

    const session: ComplianceCheckSession = {
      sessionId: randomUUID(),
      projectId,
      chapterNo,
      status: 'outline_pending',
      sourceText: chapter.content,
      selectedPersonaNames: selectedPersonaNames?.length ? selectedPersonaNames : undefined,
      traceIds: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    putComplianceSession(session);
    return {
      sessionId: session.sessionId,
      chapterNo: session.chapterNo,
    };
  }

  getSession(sessionId: string, userId?: string): ComplianceCheckSession {
    return this.requireSession(sessionId, userId);
  }

  getActiveSession(projectId: string, chapterNo: number, userId?: string) {
    if (userId) {
      this.projectsService.getSettings(projectId, userId);
    }
    const session = findActiveComplianceSession(projectId, chapterNo);
    if (!session) {
      throw new NotFoundException({
        code: COMPLIANCE_ERROR.sessionNotFound,
        msg: '无活跃的合规检验会话',
      });
    }
    return session;
  }

  patchOutline(
    sessionId: string,
    payload: {
      required: PipelineOutlineItem[];
      suggested: PipelineOutlineItem[];
      confirmed: boolean;
    },
    userId?: string
  ): ComplianceCheckSession {
    const session = this.requireSession(sessionId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const sanitized = sanitizeSensoryOutlineWithContentScan(
      { required: payload.required, suggested: payload.suggested },
      rules,
      settings.contentSafetyScanEnabled !== false
    );
    const previous = session.outline ?? createEmptyComplianceOutlineState();
    session.outline = {
      required: sanitized.required,
      suggested: sanitized.suggested,
      userConfirmed: payload.confirmed,
      revisionRound: previous.revisionRound,
      revisionHistory: previous.revisionHistory ?? [],
      confirmedAt: payload.confirmed ? new Date().toISOString() : undefined,
    };
    session.status = payload.confirmed ? 'outline_ready' : 'outline_pending';
    session.updatedAt = new Date();
    putComplianceSession(session);
    return session;
  }

  async reviseOutline(
    sessionId: string,
    payload: {
      mode?: ComplianceOutlineReviseMode;
      currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
      userFeedback?: string;
    },
    userId?: string
  ) {
    const session = this.requireSession(sessionId, userId);
    await this.projectsService.syncContextForChapterPipeline(session.projectId, userId);
    const mode: ComplianceOutlineReviseMode = payload.mode ?? 'revise';
    const feedback = payload.userFeedback?.trim() ?? '';

    if (mode === 'revise' && !feedback) {
      throw new ComplianceCheckOutlineReviseInvalidError(
        `按意见修订须填写 1~${COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS} 字修改意见`
      );
    }
    if (feedback.length > COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS) {
      throw new ComplianceCheckOutlineReviseInvalidError(
        `修改意见须不超过 ${COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS} 字`
      );
    }

    const settings = this.projectsService.getSettings(session.projectId, userId);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const forbiddenWordsSummary = buildForbiddenWordsSummary(rules);
    const preScanSummary = buildCompliancePreScanSummary(session.preScanIssues ?? []);
    const personaBlock = this.resolveCompliancePersonaBlock(session, userId);
    const baseUserPrompt = buildComplianceOutlineUserPrompt({
      sourceText: session.sourceText,
      forbiddenWordsSummary,
      preScanSummary,
      personaBlock,
    });
    const prompt = buildComplianceOutlineGateUserPrompt({
      baseUserPrompt,
      currentOutline: payload.currentOutline,
      mode,
      userFeedback: feedback || undefined,
    });
    const traceId = makeComplianceTraceId(`outline-${mode}`);
    const raw = await this.generateComplianceOutlineViaStream({
      projectId: session.projectId,
      prompt,
      traceId,
      chapterNo: session.chapterNo,
      mode,
    });

    try {
      const parsed = parsePipelineOutlineJson(raw);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      const previous = session.outline ?? createEmptyComplianceOutlineState();
      const revisionRound = (previous.revisionRound ?? 0) + 1;
      session.outline = {
        required: sanitized.required,
        suggested: sanitized.suggested,
        userConfirmed: false,
        revisionRound,
        revisionHistory: [
          ...(previous.revisionHistory ?? []),
          { required: previous.required, suggested: previous.suggested },
        ],
      };
      session.status = 'outline_pending';
      session.traceIds.outline = traceId;
      session.updatedAt = new Date();
      putComplianceSession(session);
      return {
        required: session.outline.required,
        suggested: session.outline.suggested,
        revisionRound: session.outline.revisionRound,
      };
    } catch {
      throw new BadRequestException('合规大纲 JSON 解析失败');
    }
  }

  async runPreScanStream(
    sessionId: string,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const session = this.requireSession(sessionId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const traceId = makeComplianceTraceId('pre-scan');
    session.traceIds.preScan = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'compliance_pre_scan',
    });
    callbacks.onStage?.({ stage: 'compliance_pre_scan' });

    const issues = this.runPreScanIssues(session, settings);
    session.preScanIssues = issues;
    session.updatedAt = new Date();
    putComplianceSession(session);

    callbacks.onEnd?.({
      traceId,
      preScanIssues: issues,
    });
  }

  async runOutlineStream(
    sessionId: string,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const session = this.requireSession(sessionId, userId);
    await this.projectsService.syncContextForChapterPipeline(session.projectId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    if (session.preScanIssues === undefined) {
      session.preScanIssues = this.runPreScanIssues(session, settings);
      putComplianceSession(session);
    }
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const forbiddenWordsSummary = buildForbiddenWordsSummary(rules);
    const preScanSummary = buildCompliancePreScanSummary(session.preScanIssues);
    const personaBlock = this.resolveCompliancePersonaBlock(session, userId);
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: session.sourceText,
      forbiddenWordsSummary,
      preScanSummary,
      personaBlock,
    });
    const traceId = makeComplianceTraceId('outline');
    session.traceIds.outline = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'compliance_outline',
    });
    callbacks.onStage?.({ stage: 'compliance_outline' });

    const raw = await this.generateComplianceOutlineViaStream({
      projectId: session.projectId,
      prompt,
      traceId,
      chapterNo: session.chapterNo,
    });

    try {
      const parsed = parsePipelineOutlineJson(raw);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      session.outline = {
        ...sanitized,
        userConfirmed: false,
        revisionRound: 0,
        revisionHistory: [],
      };
      session.status = 'outline_pending';
      session.updatedAt = new Date();
      putComplianceSession(session);
      callbacks.onEnd?.({
        traceId,
        outline: session.outline,
      });
    } catch {
      callbacks.onError?.('合规大纲 JSON 解析失败');
      throw new BadRequestException('合规大纲 JSON 解析失败');
    }
  }

  async runRewriteStream(
    sessionId: string,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const session = this.requireSession(sessionId, userId);
    await this.projectsService.syncContextForChapterPipeline(session.projectId, userId);
    const outline = session.outline;
    if (!outline?.userConfirmed) {
      throw new ComplianceCheckOutlineNotConfirmedError('合规大纲尚未确认');
    }

    const settings = this.projectsService.getSettings(session.projectId, userId);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const forbiddenWordsSummary = buildForbiddenWordsSummary(rules);
    const allItems = [...outline.required, ...outline.suggested];
    const sourceText = session.sourceText;
    const personaBlock = this.resolveCompliancePersonaBlock(session, userId);
    const basePrompt = buildComplianceRewriteUserPrompt({
      sourceText,
      outline: allItems,
      forbiddenWordsSummary,
      personaBlock,
    });
    const traceId = makeComplianceTraceId('rewrite');
    session.traceIds.rewrite = traceId;
    session.status = 'rewriting';

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'compliance_rewrite',
    });
    callbacks.onStage?.({ stage: 'compliance_rewrite' });

    const segmentCharSize =
      (settings as { complianceCheckSegmentCharSize?: number }).complianceCheckSegmentCharSize ??
      settings.chapterOptimizeSegmentCharSize;
    const strategy = resolvePipelineSegmentStrategy(sourceText.length, segmentCharSize);
    const segments = splitPipelineText(sourceText, segmentCharSize);
    const segmentTexts: string[] = [];

    for (let i = 0; i < segments.length; i += 1) {
      if (strategy.mode === 'segmented') {
        callbacks.onStage?.({
          stage: 'compliance_rewrite_segment',
          segmentIndex: i + 1,
          segmentTotal: segments.length,
        });
      }
      const segmentPrompt =
        segments.length > 1
          ? basePrompt.replace(sourceText, segments[i])
          : basePrompt;
      const result = await streamPipelineGeneration({
        orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
        projectId: session.projectId,
        prompt: segmentPrompt,
        templateKey: CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY,
        context: {
          ...COMPLIANCE_GENERATION_CONTEXT,
          task: 'chapter.compliance.rewrite',
          chapterNo: session.chapterNo,
          traceId,
          segmentIndex: i,
          segmentTotal: segments.length,
        },
        callbacks: { onContent: callbacks.onContent },
      });
      if (!result.ok) {
        callbacks.onError?.(result.errorMessage || '合规改写失败');
        throw new BadRequestException(result.errorMessage || '合规改写失败');
      }
      segmentTexts.push(result.text);
    }

    const versionText =
      segmentTexts.length > 1 ? mergeSegmentDraftTexts(segmentTexts) : segmentTexts[0] ?? '';

    callbacks.onStage?.({ stage: 'compliance_rescan' });
    const scanEnabled = settings.contentSafetyScanEnabled !== false;
    const fixMode = this.resolveComplianceFixMode(settings);
    const { text: fixedText, issues: residualIssues } = await this.applyComplianceResidualFixes({
      projectId: session.projectId,
      chapterNo: session.chapterNo,
      sourceText: versionText,
      rules,
      scanEnabled,
      fixMode,
      callbacks,
    });
    const qualityStatus = resolveFinalPolishQualityStatus(residualIssues);
    const rescanTraceId = makeComplianceTraceId('rescan');

    session.versionText = fixedText;
    session.residualIssues = residualIssues;
    session.qualityStatus = qualityStatus;
    session.status = 'review';
    session.traceIds.rescan = rescanTraceId;
    session.updatedAt = new Date();
    putComplianceSession(session);

    callbacks.onEnd?.({
      traceId,
      versionText: fixedText,
      qualityStatus,
      residualIssues,
    });
  }

  private resolveCompliancePersonaBlock(
    session: ComplianceCheckSession,
    userId: string | undefined
  ): string {
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    let selectedPersonaNames = session.selectedPersonaNames;
    if (!selectedPersonaNames?.length) {
      const pipelineSession = findLatestPipelineSessionForChapter(
        session.projectId,
        session.chapterNo
      );
      selectedPersonaNames = pipelineSession?.selectedPersonaNames;
    }
    return buildCompliancePersonaBlock(personas, selectedPersonaNames);
  }

  private runPreScanIssues(
    session: ComplianceCheckSession,
    settings: ReturnType<ProjectsService['getSettings']>
  ) {
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const scanEnabled = settings.contentSafetyScanEnabled !== false;
    const fixMode = this.resolveComplianceFixMode(settings);
    return sanitizeRuleIssuesForText(
      session.sourceText,
      relocateRuleIssuesInText(
        session.sourceText,
        scanPipelineRules(session.sourceText, rules, scanEnabled, fixMode)
      )
    );
  }

  private resolveComplianceFixMode(
    settings: ReturnType<ProjectsService['getSettings']>
  ): 'auto' | 'semi' | 'manual' {
    const ext = settings as {
      complianceRulesFixMode?: 'auto' | 'semi' | 'manual';
      pipelineRulesFixMode?: 'auto' | 'semi' | 'manual';
    };
    return ext.complianceRulesFixMode ?? ext.pipelineRulesFixMode ?? 'semi';
  }

  private async applyComplianceResidualFixes(input: {
    projectId: string;
    chapterNo: number;
    sourceText: string;
    rules: ReturnType<typeof mergeContentSafetyRules>;
    scanEnabled: boolean;
    fixMode: 'auto' | 'semi' | 'manual';
    callbacks: PipelineStreamCallbacks;
  }): Promise<{ text: string; issues: import('./chapter-pipeline.util').PipelineRuleIssue[] }> {
    let resultText = input.sourceText;
    let issues = sanitizeRuleIssuesForText(
      resultText,
      relocateRuleIssuesInText(
        resultText,
        scanPipelineRules(resultText, input.rules, input.scanEnabled, input.fixMode)
      )
    );

    const { text: afterAuto, issues: updatedIssues } = applyAutoFixes(
      resultText,
      issues,
      input.fixMode
    );
    resultText = afterAuto;
    issues = updatedIssues;

    let relocatedIssues = relocateRuleIssuesInText(resultText, issues);
    const pendingAi = relocatedIssues.filter(
      (issue) => !issue.fixed && shouldApplyAiSegmentFix(issue, input.fixMode)
    );

    if (pendingAi.length > 0) {
      input.callbacks.onStage?.({ stage: 'compliance_residual_fix' });
    }

    for (let index = 0; index < pendingAi.length; index += 1) {
      const issue = pendingAi[index];
      input.callbacks.onStage?.({
        stage: 'compliance_residual_fix',
        segmentIndex: index + 1,
        segmentTotal: pendingAi.length,
      });
      const fixPrompt = buildRulesFixUserPrompt({ sourceText: resultText, issue });
      let raw = '';
      try {
        const result = await streamPipelineGeneration({
          orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
          projectId: input.projectId,
          prompt: fixPrompt,
          templateKey: CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
          context: {
            task: 'chapter.compliance.residual-fix',
            chapterNo: input.chapterNo,
            issueId: issue.id,
          },
          maxTokens: COMPLIANCE_RULE_FIX_MAX_TOKENS,
          callbacks: {},
        });
        if (!result.ok) {
          continue;
        }
        raw = result.text;
      } catch {
        continue;
      }

      const { text: nextText, applied } = applyRuleSegmentFix(resultText, issue, raw);
      if (applied) {
        resultText = nextText;
        issue.fixed = true;
        const issueIndex = relocatedIssues.findIndex((item) => item.id === issue.id);
        if (issueIndex >= 0) {
          relocatedIssues[issueIndex] = { ...issue };
        }
        input.callbacks.onContent?.(raw.slice(0, 300));
      }
      relocatedIssues = relocateRuleIssuesInText(resultText, relocatedIssues);
    }

    return {
      text: resultText,
      issues: sanitizeRuleIssuesForText(resultText, relocatedIssues),
    };
  }

  applyCompliance(
    sessionId: string,
    payload: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      draftTextOverride?: string;
      forceApply?: boolean;
    },
    userId?: string
  ) {
    const session = this.requireSession(sessionId, userId);
    const draftText = payload.draftTextOverride?.trim() || session.versionText?.trim();
    if (!draftText) {
      throw new BadRequestException('尚无合规正文可应用');
    }

    if (session.qualityStatus === 'blocked' && !payload.forceApply) {
      throw new ComplianceCheckQualityBlockedError('存在阻断性硬风险，请修订后应用或确认强制应用');
    }

    const settings = this.projectsService.getSettings(session.projectId, userId);
    const preserveSummary =
      payload.preserveSummary ??
      (settings as { complianceCheckPreserveSummary?: boolean }).complianceCheckPreserveSummary ??
      true;

    const result = this.projectsService.applyChapterOptimization(
      session.projectId,
      session.chapterNo,
      {
        draftText,
        expectedChapterUpdatedAt: payload.expectedChapterUpdatedAt,
        preserveSummary,
        planId: session.sessionId,
      },
      userId
    );

    session.status = 'applied';
    session.updatedAt = new Date();
    putComplianceSession(session);
    return result;
  }

  private requireSession(sessionId: string, userId?: string): ComplianceCheckSession {
    const session = getComplianceSession(sessionId);
    if (!session) {
      throw new ComplianceCheckSessionNotFoundError('合规检验会话不存在或已过期');
    }
    if (userId) {
      this.projectsService.getSettings(session.projectId, userId);
    }
    return session;
  }
}
