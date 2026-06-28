import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mergeContentSafetyRules } from '@aether-quill/config';

const PIPELINE_ERROR = {
  sessionNotFound: 1326,
  gateNotConfirmed: 1328,
  moduleFailed: 1329,
} as const;
import {
  applyAutoFixes,
  mergeLlmRuleIssues,
  normalizeRuleIssues,
  scanPipelineRules,
} from './chapter-pipeline-rule-classifier';
import {
  generatePipelinePlainText,
  streamPipelineGeneration,
} from './chapter-pipeline-orchestrator.client';
import {
  deletePipelineSession,
  getPipelineSession,
  putPipelineSession,
} from './chapter-pipeline-session.store';

const PIPELINE_RULE_FIX_MAX_TOKENS = 2048;
const PIPELINE_RULE_FIX_TIMEOUT_MS = 120_000;
import {
  assertModulePrerequisites,
  applyRuleSegmentFix,
  buildCharacterUserPrompt,
  buildHomogenizationRewriteUserPrompt,
  buildHomogenizationScanUserPrompt,
  buildRulesFixUserPrompt,
  buildRulesScanUserPrompt,
  buildSensoryOutlineUserPrompt,
  buildSensoryRewriteUserPrompt,
  CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY,
  type ChapterPipelineConfig,
  type ChapterPipelineRunModule,
  type ChapterPipelineSession,
  type ChapterPipelineStage,
  type PipelineOutlineItem,
  type PipelineRuleIssue,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_PROTAGONIST_PROGRESS_RULES,
  getPipelineInputText,
  makePipelineSessionId,
  makePipelineTraceId,
  mergePipelineConfig,
  parseHomogenizationReportJson,
  parseRuleIssuesJson,
  parseSensoryOutlineJson,
  relocateRuleIssuesInText,
  resolvePipelineApplyText,
  sanitizeRuleIssuesForText,
  sanitizeSensoryOutlineWithContentScan,
  shouldApplyAiSegmentFix,
  resolvePipelineSegmentStrategy,
  resolveProtagonistContext,
  splitPipelineText,
} from './chapter-pipeline.util';
import { mergeSegmentDraftTexts } from './chapter-optimize.util';
import type { PersonaRecord } from './projects.service';
import { ProjectsService } from './projects.service';

export class ChapterPipelineSessionNotFoundError extends Error {
  readonly code = PIPELINE_ERROR.sessionNotFound;
}

export class ChapterPipelineGateNotConfirmedError extends Error {
  readonly code = PIPELINE_ERROR.gateNotConfirmed;
}

export class ChapterPipelineModuleFailedError extends Error {
  readonly code = PIPELINE_ERROR.moduleFailed;
  constructor(
    message: string,
    readonly module: string
  ) {
    super(message);
  }
}

@Injectable()
export class ChapterPipelineService {
  constructor(private readonly projectsService: ProjectsService) {}

  startSession(
    projectId: string,
    chapterNo: number,
    payload: {
      preset?: string;
      configOverrides?: Partial<ChapterPipelineConfig>;
    },
    userId?: string
  ): ChapterPipelineStartResult {
    if (userId) {
      this.projectsService.getSettings(projectId, userId);
    }
    const chapter = this.projectsService.getChapterRecordForPipeline(projectId, chapterNo);
    if (!chapter?.content?.trim()) {
      throw new BadRequestException(`第${chapterNo}章正文为空，无法启动分步精修`);
    }

    const settings = this.projectsService.getSettings(projectId, userId);
    const projectPipelineDefaults = this.resolveProjectPipelineDefaults(settings);
    const config = mergePipelineConfig(projectPipelineDefaults, {
      ...(payload.configOverrides ?? {}),
      ...(payload.preset
        ? { pipelinePreset: payload.preset as ChapterPipelineConfig['pipelinePreset'] }
        : {}),
    });

    const session: ChapterPipelineSession = {
      sessionId: makePipelineSessionId(),
      projectId,
      chapterNo,
      userId,
      sourceText: chapter.content,
      sourceUpdatedAt: chapter.updatedAt.toISOString(),
      versions: { original: chapter.content },
      config,
      currentModule: config.pipelineEnabledModules[0] ?? 1,
      traceIds: {},
      createdAt: new Date(),
    };

    putPipelineSession(session);
    return { sessionId: session.sessionId, chapterNo, config, session };
  }

  getSession(sessionId: string, userId?: string): ChapterPipelineSession {
    const session = this.requireSession(sessionId, userId);
    return session;
  }

  patchSensoryOutline(
    sessionId: string,
    payload: {
      required: PipelineOutlineItem[];
      suggested: PipelineOutlineItem[];
      confirmed: boolean;
    },
    userId?: string
  ): ChapterPipelineSession {
    const session = this.requireSession(sessionId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const sanitized = sanitizeSensoryOutlineWithContentScan(
      { required: payload.required, suggested: payload.suggested },
      rules,
      settings.contentSafetyScanEnabled !== false
    );
    session.sensoryOutline = {
      required: sanitized.required,
      suggested: sanitized.suggested,
      userConfirmed: payload.confirmed,
    };
    putPipelineSession(session);
    return session;
  }

  async applyPipeline(
    sessionId: string,
    payload: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      useVersion?: 'afterRules' | 'final';
    },
    userId?: string
  ) {
    const session = this.requireSession(sessionId, userId);
    const draftText = resolvePipelineApplyText(session, payload.useVersion ?? 'final');
    return this.projectsService.applyChapterOptimization(
      session.projectId,
      session.chapterNo,
      {
        draftText,
        expectedChapterUpdatedAt: payload.expectedChapterUpdatedAt,
        preserveSummary: payload.preserveSummary,
        planId: session.sessionId,
      },
      userId
    );
  }

  async runModuleStream(
    sessionId: string,
    module: ChapterPipelineRunModule,
    payload: { issueId?: string },
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const session = this.requireSession(sessionId, userId);

    try {
      assertModulePrerequisites(session, module);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模块前置条件不满足';
      if (message.includes('尚未确认')) {
        throw new ChapterPipelineGateNotConfirmedError(message);
      }
      callbacks.onError?.(message);
      return;
    }

    if (module === 'run-all') {
      await this.runAllModules(session, userId, callbacks);
      return;
    }

    if (module === 'rules-fix' && payload.issueId) {
      await this.runRulesFixForIssue(session, payload.issueId, userId, callbacks);
      return;
    }

    switch (module) {
      case 'character':
        await this.runCharacterModule(session, userId, callbacks);
        break;
      case 'sensory-outline':
        await this.runSensoryOutlineModule(session, userId, callbacks);
        break;
      case 'sensory-rewrite':
        await this.runSensoryRewriteModule(session, userId, callbacks);
        break;
      case 'rules-scan':
        await this.runRulesScanModule(session, userId, callbacks);
        break;
      case 'rules-fix':
        await this.runRulesFixAll(session, userId, callbacks);
        break;
      case 'homogenization-scan':
      case 'homogenization':
        await this.runHomogenizationScanModule(session, userId, callbacks);
        break;
      case 'homogenization-rewrite':
        await this.runHomogenizationRewriteModule(session, userId, callbacks);
        break;
      default:
        callbacks.onError?.(`未知模块: ${module}`);
    }
  }

  private async runAllModules(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const enabled = session.config.pipelineEnabledModules;

    if (enabled.includes(1) && !session.versions.afterCharacter?.trim()) {
      await this.runCharacterModule(session, userId, callbacks);
      if (!session.versions.afterCharacter) {
        return;
      }
    }

    if (enabled.includes(2)) {
      if (!session.sensoryOutline) {
        await this.runSensoryOutlineModule(session, userId, callbacks);
      }
      if (
        !session.config.pipelineSkipSensoryOutlineReview &&
        !session.sensoryOutline?.userConfirmed
      ) {
        callbacks.onGate?.('sensory-outline');
        return;
      }
      if (!session.versions.afterSensory?.trim()) {
        await this.runSensoryRewriteModule(session, userId, callbacks);
      }
    }

    if (enabled.includes(3) && !session.versions.afterRules?.trim()) {
      if (session.ruleIssues === undefined) {
        await this.runRulesScanModule(session, userId, callbacks);
      }
      await this.runRulesFixAll(session, userId, callbacks);
    }

    if (
      enabled.includes(4) &&
      session.config.pipelineHomogenizationEnabled &&
      !session.versions.final?.trim()
    ) {
      if (session.homogenizationReport === undefined) {
        await this.runHomogenizationScanModule(session, userId, callbacks);
      }
      await this.runHomogenizationRewriteModule(session, userId, callbacks);
    }

    session.currentModule = 'done';
    putPipelineSession(session);
    callbacks.onEnd?.({ sessionId: session.sessionId, currentModule: 'done' });
  }

  private async runCharacterModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
    const protagonistRules =
      (settings as { protagonistProgressRules?: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES })
        .protagonistProgressRules ?? DEFAULT_PROTAGONIST_PROGRESS_RULES;

    const sourceText = getPipelineInputText(session, 1);
    const protagonistContext = resolveProtagonistContext(
      session.chapterNo,
      protagonistRules,
      protagonist
    );
    const personaBlock = this.buildPersonaBlock(personas);
    const prompt = buildCharacterUserPrompt({ sourceText, protagonistContext, personaBlock });
    const traceId = makePipelineTraceId('character');
    session.traceIds.character = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_character',
    });
    callbacks.onStage?.({ stage: 'pipeline_character' });

    const segmentCharSize = settings.chapterOptimizeSegmentCharSize;
    const strategy = resolvePipelineSegmentStrategy(sourceText.length, segmentCharSize);
    const segments = splitPipelineText(sourceText, segmentCharSize);
    const chapter = this.projectsService.getChapterRecordForPipeline(
      session.projectId,
      session.chapterNo
    );
    const segmentTexts: string[] = [];

    for (let i = 0; i < segments.length; i += 1) {
      if (strategy.mode === 'segmented') {
        callbacks.onStage?.({
          stage: 'draft_segment',
          segmentIndex: i + 1,
          segmentTotal: segments.length,
        });
      }
      const result = await streamPipelineGeneration({
        orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
        projectId: session.projectId,
        prompt: prompt.replace(sourceText, segments[i]),
        templateKey: CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY,
        context: {
          task: 'chapter.pipeline.character',
          chapterNo: session.chapterNo,
          traceId,
          segmentIndex: i,
          segmentTotal: segments.length,
          retrievalChapterTitle: chapter?.title ?? '',
        },
        callbacks: {
          onContent: callbacks.onContent,
        },
      });
      if (!result.ok) {
        callbacks.onError?.(result.errorMessage || '角色调整失败');
        throw new ChapterPipelineModuleFailedError(result.errorMessage || '角色调整失败', 'character');
      }
      segmentTexts.push(result.text);
    }

    const merged =
      segmentTexts.length > 1 ? mergeSegmentDraftTexts(segmentTexts) : segmentTexts[0] ?? '';
    session.versions.afterCharacter = merged;
    session.currentModule = 2;
    putPipelineSession(session);
    callbacks.onEnd?.({
      traceId,
      versionText: merged,
      versionKey: 'afterCharacter',
      currentModule: 2,
    });
  }

  private async runSensoryOutlineModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 2);
    const prompt = buildSensoryOutlineUserPrompt({
      sourceText,
      personaBlock: this.buildPersonaBlock(personas),
    });
    const traceId = makePipelineTraceId('sensory-outline');
    session.traceIds.sensoryOutline = traceId;

    callbacks.onStart?.({ traceId, chapterNo: session.chapterNo, stage: 'pipeline_sensory_outline' });
    callbacks.onStage?.({ stage: 'pipeline_sensory_outline' });

    const raw = await generatePipelinePlainText({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY,
      context: { task: 'chapter.pipeline.sensory.outline', chapterNo: session.chapterNo, traceId },
    });

    try {
      const parsed = parseSensoryOutlineJson(raw);
      const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      session.sensoryOutline = {
        ...sanitized,
        userConfirmed: session.config.pipelineSkipSensoryOutlineReview,
      };
      putPipelineSession(session);
      callbacks.onEnd?.({
        traceId,
        sensoryOutline: session.sensoryOutline,
        currentModule: 2,
      });
    } catch {
      callbacks.onError?.('感官大纲 JSON 解析失败');
      throw new ChapterPipelineModuleFailedError('感官大纲 JSON 解析失败', 'sensory-outline');
    }
  }

  private async runSensoryRewriteModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const outline = session.sensoryOutline;
    if (!outline) {
      throw new ChapterPipelineGateNotConfirmedError('感官大纲尚未生成');
    }
    if (!outline.userConfirmed && !session.config.pipelineSkipSensoryOutlineReview) {
      throw new ChapterPipelineGateNotConfirmedError('感官大纲尚未确认');
    }

    await this.prepareContext(session.projectId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 2);
    const allItems = [...outline.required, ...outline.suggested];
    const prompt = buildSensoryRewriteUserPrompt({
      sourceText,
      outline: allItems,
      personaBlock: this.buildPersonaBlock(personas),
    });
    const traceId = makePipelineTraceId('sensory-rewrite');
    session.traceIds.sensoryRewrite = traceId;

    callbacks.onStart?.({ traceId, chapterNo: session.chapterNo, stage: 'pipeline_sensory_rewrite' });
    callbacks.onStage?.({ stage: 'pipeline_sensory_rewrite' });

    const result = await streamPipelineGeneration({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY,
      context: { task: 'chapter.pipeline.sensory.rewrite', chapterNo: session.chapterNo, traceId },
      callbacks: { onContent: callbacks.onContent },
    });

    if (!result.ok) {
      callbacks.onError?.(result.errorMessage || '感官改写失败');
      throw new ChapterPipelineModuleFailedError(result.errorMessage || '感官改写失败', 'sensory-rewrite');
    }

    session.versions.afterSensory = result.text;
    session.currentModule = 3;
    putPipelineSession(session);
    callbacks.onEnd?.({
      traceId,
      versionText: result.text,
      versionKey: 'afterSensory',
      currentModule: 3,
    });
  }

  private async runRulesScanModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
    const protagonistName = protagonist?.name ?? '主角';
    const personaBlock = this.buildPersonaBlock(personas);
    const sourceText = getPipelineInputText(session, 3);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const deterministic = scanPipelineRules(
      sourceText,
      rules,
      settings.contentSafetyScanEnabled !== false,
      session.config.pipelineRulesFixMode,
      protagonistName
    );

    callbacks.onStart?.({
      traceId: makePipelineTraceId('rules-scan'),
      chapterNo: session.chapterNo,
      stage: 'pipeline_rules_scan',
    });
    callbacks.onStage?.({ stage: 'pipeline_rules_scan' });

    let llmIssues: PipelineRuleIssue[] = [];
    try {
      const raw = await generatePipelinePlainText({
        orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
        projectId: session.projectId,
        prompt: buildRulesScanUserPrompt({ sourceText, personaBlock }),
        templateKey: CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY,
        context: { task: 'chapter.pipeline.rules.scan', chapterNo: session.chapterNo },
      });
      if (raw) {
        llmIssues = normalizeRuleIssues(
          parseRuleIssuesJson(raw),
          session.config.pipelineRulesFixMode
        );
      }
    } catch {
      // LLM scan optional; deterministic rules still apply
    }

    session.ruleIssues = sanitizeRuleIssuesForText(
      sourceText,
      mergeLlmRuleIssues(deterministic, llmIssues)
    );
    session.currentModule = 3;
    putPipelineSession(session);
    callbacks.onEnd?.({
      ruleIssues: session.ruleIssues,
      currentModule: 3,
    });
  }

  private async runRulesFixAll(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
    const protagonistName = protagonist?.name ?? '主角';
    const sourceText = getPipelineInputText(session, 3);
    const issues = sanitizeRuleIssuesForText(
      sourceText,
      session.ruleIssues ?? []
    );
    const { text: afterAuto, issues: updatedIssues } = applyAutoFixes(
      sourceText,
      issues,
      session.config.pipelineRulesFixMode,
      protagonistName
    );

    let resultText = afterAuto;
    let relocatedIssues = relocateRuleIssuesInText(resultText, updatedIssues);
    const pendingAi = relocatedIssues.filter(
      (i) => !i.fixed && shouldApplyAiSegmentFix(i, session.config.pipelineRulesFixMode)
    );

    callbacks.onStage?.({ stage: 'pipeline_rules_fix' });

    for (let index = 0; index < pendingAi.length; index += 1) {
      const issue = pendingAi[index];
      callbacks.onStage?.({
        stage: 'pipeline_rules_fix',
        segmentIndex: index + 1,
        segmentTotal: pendingAi.length,
      });
      const fixPrompt = buildRulesFixUserPrompt({ sourceText: resultText, issue });
      let raw = '';
      try {
        raw = await generatePipelinePlainText({
          orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
          projectId: session.projectId,
          prompt: fixPrompt,
          templateKey: CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
          context: {
            task: 'chapter.pipeline.rules.fix',
            chapterNo: session.chapterNo,
            issueId: issue.id,
          },
          maxTokens: PIPELINE_RULE_FIX_MAX_TOKENS,
          timeoutMs: PIPELINE_RULE_FIX_TIMEOUT_MS,
        });
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
        callbacks.onContent?.(raw.slice(0, 300));
      }
      relocatedIssues = relocateRuleIssuesInText(resultText, relocatedIssues);
    }

    session.versions.afterRules = resultText;
    session.ruleIssues = relocatedIssues;
    session.currentModule = session.config.pipelineEnabledModules.includes(4) ? 4 : 'done';
    putPipelineSession(session);
    callbacks.onEnd?.({
      versionText: resultText,
      versionKey: 'afterRules',
      ruleIssues: relocatedIssues,
      currentModule: session.currentModule,
    });
  }

  private async runRulesFixForIssue(
    session: ChapterPipelineSession,
    issueId: string,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const sourceText = session.versions.afterRules ?? getPipelineInputText(session, 3);
    const issue = session.ruleIssues?.find((i) => i.id === issueId);
    if (!issue) {
      callbacks.onError?.(`未找到 issue: ${issueId}`);
      return;
    }

    callbacks.onStage?.({ stage: 'pipeline_rules_fix' });
    const fixPrompt = buildRulesFixUserPrompt({ sourceText, issue });
    let raw = '';
    try {
      raw = await generatePipelinePlainText({
        orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
        projectId: session.projectId,
        prompt: fixPrompt,
        templateKey: CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
        context: {
          task: 'chapter.pipeline.rules.fix',
          chapterNo: session.chapterNo,
          issueId,
        },
        maxTokens: PIPELINE_RULE_FIX_MAX_TOKENS,
        timeoutMs: PIPELINE_RULE_FIX_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '规则修复失败';
      callbacks.onError?.(message);
      return;
    }

    const { text: resultText, applied } = applyRuleSegmentFix(sourceText, issue, raw);
    if (!applied) {
      callbacks.onError?.('规则修复结果无效，请重试');
      return;
    }

    issue.fixed = true;
    session.versions.afterRules = resultText;
    putPipelineSession(session);
    callbacks.onContent?.(raw.slice(0, 300));
    callbacks.onEnd?.({ versionText: resultText, versionKey: 'afterRules', issueId });
  }

  private async runHomogenizationScanModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 4);
    const priorExcerpts = this.projectsService.getPriorChapterExcerpts(
      session.projectId,
      session.chapterNo,
      session.config.pipelineHomogenizationPriorChapterCount
    );
    const prompt = buildHomogenizationScanUserPrompt({ sourceText, priorExcerpts });
    const traceId = makePipelineTraceId('homogenization-scan');

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_homogenization_scan',
    });
    callbacks.onStage?.({ stage: 'pipeline_homogenization_scan' });

    const raw = await generatePipelinePlainText({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY,
      context: { task: 'chapter.pipeline.homogenization.scan', chapterNo: session.chapterNo, traceId },
    });

    try {
      session.homogenizationReport = parseHomogenizationReportJson(raw);
      putPipelineSession(session);
      callbacks.onEnd?.({
        traceId,
        homogenizationReport: session.homogenizationReport,
        currentModule: 4,
      });
    } catch {
      session.homogenizationReport = [];
      putPipelineSession(session);
      callbacks.onEnd?.({ traceId, homogenizationReport: [], currentModule: 4 });
    }
  }

  private async runHomogenizationRewriteModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 4);
    const report = session.homogenizationReport ?? [];
    const prompt = buildHomogenizationRewriteUserPrompt({ sourceText, report });
    const traceId = makePipelineTraceId('homogenization-rewrite');

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_homogenization_rewrite',
    });
    callbacks.onStage?.({ stage: 'pipeline_homogenization_rewrite' });

    const result = await streamPipelineGeneration({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY,
      context: {
        task: 'chapter.pipeline.homogenization.rewrite',
        chapterNo: session.chapterNo,
        traceId,
      },
      callbacks: { onContent: callbacks.onContent },
    });

    if (!result.ok) {
      callbacks.onError?.(result.errorMessage || '同质化改写失败');
      throw new ChapterPipelineModuleFailedError(
        result.errorMessage || '同质化改写失败',
        'homogenization-rewrite'
      );
    }

    session.versions.final = result.text;
    session.currentModule = 'done';
    putPipelineSession(session);
    callbacks.onEnd?.({
      traceId,
      versionText: result.text,
      versionKey: 'final',
      currentModule: 'done',
    });
  }

  private requireSession(sessionId: string, userId?: string): ChapterPipelineSession {
    const session = getPipelineSession(sessionId);
    if (!session) {
      throw new NotFoundException({
        code: PIPELINE_ERROR.sessionNotFound,
        msg: '分步精修会话不存在或已过期',
        sessionId,
      });
    }
    if (userId && session.userId && session.userId !== userId) {
      throw new NotFoundException({
        code: PIPELINE_ERROR.sessionNotFound,
        msg: '分步精修会话不存在或已过期',
        sessionId,
      });
    }
    return session;
  }

  private async prepareContext(projectId: string, userId?: string): Promise<void> {
    await this.projectsService.syncContextForChapterPipeline(projectId, userId);
  }

  private resolveProtagonist(personas: PersonaRecord[], activePersonaId?: string | null) {
    const published = personas.filter((p) => p.status === 'published');
    const protagonist =
      (activePersonaId && published.find((p) => p.id === activePersonaId)) || published[0];
    if (!protagonist) {
      return undefined;
    }
    return {
      name: protagonist.name,
      profile: protagonist.profile,
      chapterStates: protagonist.chapterStates?.map((s) => ({
        chapterNo: s.chapterNo,
        appearance: s.snapshot?.appearance,
        state: s.snapshot?.status ?? s.summaryLine,
      })),
    };
  }

  private buildPersonaBlock(personas: PersonaRecord[]): string {
    return personas
      .filter((p) => p.status === 'published')
      .map((p) => `${p.name}：${p.profile}\n状态：${p.state}`)
      .join('\n\n');
  }

  private resolveProjectPipelineDefaults(
    settings: ReturnType<ProjectsService['getSettings']>
  ): Partial<ChapterPipelineConfig> & {
    protagonistProgressRules?: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES;
  } {
    const ext = settings as Partial<ChapterPipelineConfig> & {
      protagonistProgressRules?: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES;
    };
    return {
      pipelinePreset: ext.pipelinePreset ?? DEFAULT_PIPELINE_CONFIG.pipelinePreset,
      pipelineSkipSensoryOutlineReview:
        ext.pipelineSkipSensoryOutlineReview ??
        DEFAULT_PIPELINE_CONFIG.pipelineSkipSensoryOutlineReview,
      pipelineRulesFixMode:
        ext.pipelineRulesFixMode ?? DEFAULT_PIPELINE_CONFIG.pipelineRulesFixMode,
      pipelineHomogenizationEnabled:
        ext.pipelineHomogenizationEnabled ?? DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationEnabled,
      pipelineHomogenizationPriorChapterCount:
        ext.pipelineHomogenizationPriorChapterCount ??
        DEFAULT_PIPELINE_CONFIG.pipelineHomogenizationPriorChapterCount,
      pipelineEnabledModules:
        ext.pipelineEnabledModules ?? DEFAULT_PIPELINE_CONFIG.pipelineEnabledModules,
      protagonistProgressRules:
        ext.protagonistProgressRules ?? DEFAULT_PROTAGONIST_PROGRESS_RULES,
    };
  }
}

export interface ChapterPipelineStartResult {
  sessionId: string;
  chapterNo: number;
  config: ChapterPipelineConfig;
  session: ChapterPipelineSession;
}

export interface PipelineStreamCallbacks {
  onStart?: (event: {
    traceId: string;
    chapterNo: number;
    stage: ChapterPipelineStage;
  }) => void;
  onStage?: (event: {
    stage: ChapterPipelineStage | 'draft_segment';
    segmentIndex?: number;
    segmentTotal?: number;
  }) => void;
  onContent?: (text: string) => void;
  onEnd?: (event: Record<string, unknown>) => void;
  onError?: (message: string) => void;
  onGate?: (gate: 'sensory-outline') => void;
}
