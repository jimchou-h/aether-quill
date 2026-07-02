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
  outlineReviseInvalid: 1331,
} as const;
import {
  applyAutoFixes,
  mergeLlmRuleIssues,
  normalizeRuleIssues,
  scanPipelineRules,
} from './chapter-pipeline-rule-classifier';
import {
  streamPipelineGeneration,
} from './chapter-pipeline-orchestrator.client';
import { logPipelinePlainTextDebug, isPipelinePromptLoggingEnabled } from './chapter-pipeline-debug';
import {
  deletePipelineSession,
  getFinalPolishCache,
  getPipelineSession,
  putFinalPolishCache,
  putPipelineSession,
} from './chapter-pipeline-session.store';

const PIPELINE_RULE_FIX_MAX_TOKENS = 2048;
import {
  assertModulePrerequisites,
  applyRuleSegmentFix,
  buildCharacterUserPrompt,
  buildCharacterOutlineUserPrompt,
  buildCharacterTraitsOutlineUserPrompt,
  buildCharacterTraitsRewriteUserPrompt,
  buildOutlineGateRecheckUserPrompt,
  buildHomogenizationRewriteUserPrompt,
  buildHomogenizationScanUserPrompt,
  buildRulesFixUserPrompt,
  buildRulesScanUserPrompt,
  buildSensoryOutlineUserPrompt,
  buildSensoryRewriteUserPrompt,
  CHAPTER_PIPELINE_CHARACTER_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_CHARACTER_TRAITS_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_REWRITE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_HOMOGENIZATION_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
  CHAPTER_PIPELINE_RULES_SCAN_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_OUTLINE_TEMPLATE_KEY,
  CHAPTER_PIPELINE_SENSORY_REWRITE_TEMPLATE_KEY,
  type ChapterPipelineConfig,
  type ChapterPipelineOutlineGate,
  type ChapterPipelineOutlineReviseMode,
  type ChapterPipelineOutlineType,
  type ChapterPipelineRunModule,
  type ChapterPipelineSession,
  type ChapterPipelineStage,
  type FinalPolishResult,
  type PipelineOutlineItem,
  type PipelineOutlineState,
  type PipelineRuleIssue,
  computeContentSafetyRulesFingerprint,
  computeFinalPolishFingerprint,
  computePersonasFingerprint,
  createEmptyOutlineState,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_PROTAGONIST_PROGRESS_RULES,
  filterPipelinePersonas,
  getOutlineState,
  getPipelineInputText,
  hashFingerprintPart,
  isPipelineEditableVersionKey,
  makePipelineSessionId,
  makePipelineTraceId,
  mergePipelineConfig,
  parseHomogenizationReportJson,
  parsePipelineOutlineJson,
  parseRuleIssuesJson,
  parseSensoryOutlineJson,
  PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS,
  pushOutlineRevisionHistory,
  relocateRuleIssuesInText,
  resolveFinalPolishQualityStatus,
  resolveOutlineGenerationTemplateKey,
  resolveOutlineSourceText,
  resolvePipelineApplyText,
  sanitizeRuleIssuesForText,
  sanitizeSensoryOutlineWithContentScan,
  setOutlineState,
  shouldApplyAiSegmentFix,
  shouldRunCharacterTraitsModule,
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

export class ChapterPipelineOutlineReviseInvalidError extends Error {
  readonly code = PIPELINE_ERROR.outlineReviseInvalid;
}

@Injectable()
export class ChapterPipelineService {
  constructor(private readonly projectsService: ProjectsService) {}

  private async generatePipelineTextViaStream(input: {
    projectId: string;
    prompt: string;
    templateKey: string;
    context: Record<string, unknown>;
    maxTokens?: number;
    onContent?: (piece: string) => void;
  }): Promise<string> {
    const result = await streamPipelineGeneration({
      orchestratorUrl: this.projectsService.getRagOrchestratorUrlForPipeline(),
      projectId: input.projectId,
      prompt: input.prompt,
      templateKey: input.templateKey,
      maxTokens: input.maxTokens,
      context: input.context,
      callbacks: input.onContent ? { onContent: input.onContent } : {},
    });
    if (!result.ok) {
      throw new Error(result.errorMessage || '调用生成服务失败');
    }
    return result.text;
  }

  startSession(
    projectId: string,
    chapterNo: number,
    payload: {
      preset?: string;
      mode?: 'pipeline' | 'final-polish';
      configOverrides?: Partial<ChapterPipelineConfig>;
      selectedPersonaNames?: string[];
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
    const finalPolishDefaults =
      payload.mode === 'final-polish'
        ? {
            pipelinePreset: 'full' as ChapterPipelineConfig['pipelinePreset'],
            pipelineSkipCharacterOutlineReview: true,
            pipelineSkipCharacterTraitsOutlineReview: true,
            pipelineSkipSensoryOutlineReview: true,
            pipelineRulesFixMode: 'semi' as ChapterPipelineConfig['pipelineRulesFixMode'],
          }
        : {};
    const config = mergePipelineConfig(projectPipelineDefaults, {
      ...finalPolishDefaults,
      ...(payload.configOverrides ?? {}),
      ...(payload.preset
        ? { pipelinePreset: payload.preset as ChapterPipelineConfig['pipelinePreset'] }
        : {}),
    });

    const selectedPersonaNames = payload.selectedPersonaNames
      ?.map((name) => name.trim())
      .filter((name) => name.length > 0);

    const session: ChapterPipelineSession = {
      sessionId: makePipelineSessionId(),
      projectId,
      chapterNo,
      userId,
      sourceText: chapter.content,
      sourceUpdatedAt: chapter.updatedAt.toISOString(),
      versions: { original: chapter.content },
      selectedPersonaNames: selectedPersonaNames?.length ? selectedPersonaNames : undefined,
      config,
      currentModule: config.pipelineEnabledModules[0] ?? 1,
      traceIds: {},
      createdAt: new Date(),
      sessionMode: payload.mode ?? 'pipeline',
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
    return this.patchOutline(sessionId, 'sensory', payload, userId);
  }

  patchOutline(
    sessionId: string,
    outlineType: ChapterPipelineOutlineType,
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
    const previous = getOutlineState(session, outlineType);
    setOutlineState(session, outlineType, {
      required: sanitized.required,
      suggested: sanitized.suggested,
      userConfirmed: payload.confirmed,
      revisionRound: previous?.revisionRound ?? 0,
      revisionHistory: previous?.revisionHistory ?? [],
    });
    putPipelineSession(session);
    return session;
  }

  patchPipelineVersion(
    sessionId: string,
    payload: { versionKey: string; text: string },
    userId?: string
  ): ChapterPipelineSession {
    const session = this.requireSession(sessionId, userId);
    if (!isPipelineEditableVersionKey(payload.versionKey)) {
      throw new BadRequestException(`无效的 versionKey: ${payload.versionKey}`);
    }
    const text = payload.text.trim();
    if (!text) {
      throw new BadRequestException('version 正文不能为空');
    }
    session.versions[payload.versionKey] = text;
    putPipelineSession(session);
    return session;
  }

  async reviseOutline(
    sessionId: string,
    payload: {
      outlineType: ChapterPipelineOutlineType;
      mode?: ChapterPipelineOutlineReviseMode;
      currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
      userFeedback?: string;
    },
    userId?: string
  ): Promise<{
    required: PipelineOutlineItem[];
    suggested: PipelineOutlineItem[];
    revisionRound: number;
  }> {
    const session = this.requireSession(sessionId, userId);
    const mode: ChapterPipelineOutlineReviseMode = payload.mode ?? 'revise';
    const feedback = payload.userFeedback?.trim() ?? '';

    if (mode === 'revise' && !feedback) {
      throw new ChapterPipelineOutlineReviseInvalidError(
        `按意见修订须填写 1~${PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS} 字修改意见`
      );
    }
    if (feedback.length > PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS) {
      throw new ChapterPipelineOutlineReviseInvalidError(
        `修改意见须不超过 ${PIPELINE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS} 字`
      );
    }

    await this.prepareContext(session);
    const previous = getOutlineState(session, payload.outlineType) ?? createEmptyOutlineState();
    const revisionRound = (previous.revisionRound ?? 0) + 1;
    const baseUserPrompt = this.buildOutlineBaseUserPrompt(session, payload.outlineType, userId);
    const prompt = buildOutlineGateRecheckUserPrompt({
      baseUserPrompt,
      currentOutline: payload.currentOutline,
      mode,
      revisionRound,
      userFeedback: feedback || undefined,
    });
    const templateKey = resolveOutlineGenerationTemplateKey(payload.outlineType);
    const traceId = makePipelineTraceId(`outline-${mode}`);
    const taskSuffix = mode === 'recheck' ? 'outline.recheck' : 'outline.revise';
    const raw = await this.generatePipelineTextViaStream({
      projectId: session.projectId,
      prompt,
      templateKey,
      context: {
        task: `chapter.pipeline.${payload.outlineType}.${taskSuffix}`,
        chapterNo: session.chapterNo,
        traceId,
        outlineType: payload.outlineType,
        mode,
      },
    });

    try {
      const parsed = parsePipelineOutlineJson(raw);
      const settings = this.projectsService.getSettings(session.projectId, userId);
      const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      pushOutlineRevisionHistory(previous);
      const nextState: PipelineOutlineState = {
        required: sanitized.required,
        suggested: sanitized.suggested,
        userConfirmed: false,
        revisionRound,
        revisionHistory: previous.revisionHistory,
      };
      setOutlineState(session, payload.outlineType, nextState);
      putPipelineSession(session);
      return {
        required: nextState.required,
        suggested: nextState.suggested,
        revisionRound: nextState.revisionRound,
      };
    } catch {
      throw new ChapterPipelineModuleFailedError('大纲修订 JSON 解析失败', 'outline-revise');
    }
  }

  async applyPipeline(
    sessionId: string,
    payload: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      useVersion?: 'afterRules' | 'final';
      draftTextOverride?: string;
    },
    userId?: string
  ) {
    const session = this.requireSession(sessionId, userId);
    const draftText =
      payload.draftTextOverride?.trim() ||
      resolvePipelineApplyText(session, payload.useVersion ?? 'final');
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
    payload: { issueId?: string; forceRegenerate?: boolean },
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const session = this.requireSession(sessionId, userId);

    if (module !== 'final-polish') {
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
      case 'character-outline':
        await this.runCharacterOutlineModule(session, userId, callbacks);
        break;
      case 'character':
        await this.runCharacterModule(session, userId, callbacks);
        break;
      case 'character-traits-outline':
        await this.runCharacterTraitsOutlineModule(session, userId, callbacks);
        break;
      case 'character-traits':
        await this.runCharacterTraitsModule(session, userId, callbacks);
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
      case 'final-polish':
        await this.runFinalPolishModule(session, userId, callbacks, {
          forceRegenerate: payload.forceRegenerate,
        });
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
    const traitsEnabled = shouldRunCharacterTraitsModule(session.config);

    if (enabled.includes(1)) {
      if (!session.characterOutline) {
        await this.runCharacterOutlineModule(session, userId, callbacks);
      }
      if (
        !session.config.pipelineSkipCharacterOutlineReview &&
        !session.characterOutline?.userConfirmed
      ) {
        callbacks.onGate?.('character-outline', {
          characterOutline: session.characterOutline,
        });
        return;
      }
      if (!session.versions.afterCharacter?.trim()) {
        await this.runCharacterModule(session, userId, callbacks);
        if (!session.versions.afterCharacter) {
          return;
        }
      }

      if (traitsEnabled) {
        if (!session.characterTraitsOutline) {
          await this.runCharacterTraitsOutlineModule(session, userId, callbacks);
        }
        if (
          !session.config.pipelineSkipCharacterTraitsOutlineReview &&
          !session.characterTraitsOutline?.userConfirmed
        ) {
          callbacks.onGate?.('character-traits-outline', {
            characterTraitsOutline: session.characterTraitsOutline,
          });
          return;
        }
        if (!session.versions.afterCharacterTraits?.trim()) {
          await this.runCharacterTraitsModule(session, userId, callbacks);
        }
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
        callbacks.onGate?.('sensory-outline', {
          sensoryOutline: session.sensoryOutline,
        });
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

  private async runCharacterOutlineModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session);
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
    const prompt = buildCharacterOutlineUserPrompt({
      sourceText,
      protagonistContext,
      personaBlock: this.buildPersonaBlock(personas, session),
    });
    const traceId = makePipelineTraceId('character-outline');
    session.traceIds.characterOutline = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_character_outline',
    });
    callbacks.onStage?.({ stage: 'pipeline_character_outline' });

    const raw = await this.generatePipelineTextViaStream({
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_CHARACTER_OUTLINE_TEMPLATE_KEY,
      context: { task: 'chapter.pipeline.character.outline', chapterNo: session.chapterNo, traceId },
    });

    try {
      const parsed = parsePipelineOutlineJson(raw);
      const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      session.characterOutline = {
        ...sanitized,
        userConfirmed: session.config.pipelineSkipCharacterOutlineReview,
        revisionRound: 0,
        revisionHistory: [],
      };
      putPipelineSession(session);
      callbacks.onEnd?.({
        traceId,
        characterOutline: session.characterOutline,
        currentModule: 1,
      });
    } catch {
      callbacks.onError?.('角色调整大纲 JSON 解析失败');
      throw new ChapterPipelineModuleFailedError('角色调整大纲 JSON 解析失败', 'character-outline');
    }
  }

  private async runCharacterModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session);
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
    const characterOutline = session.characterOutline;
    const outlineItems = characterOutline
      ? [...characterOutline.required, ...characterOutline.suggested]
      : undefined;
    const prompt = buildCharacterUserPrompt({
      sourceText,
      protagonistContext,
      personaBlock: this.buildPersonaBlock(personas, session),
      outline: outlineItems,
    });
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
    const traitsEnabled = shouldRunCharacterTraitsModule(session.config);
    session.currentModule = traitsEnabled ? 1 : 2;
    putPipelineSession(session);
    callbacks.onEnd?.({
      traceId,
      versionText: merged,
      versionKey: 'afterCharacter',
      currentModule: traitsEnabled ? 1 : 2,
    });
  }

  private async runCharacterTraitsOutlineModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const resolvedPersonas = this.resolveSessionPersonas(session, personas);
    const personaBlock = this.buildPersonaBlock(personas, session);
    const sourceText = session.versions.afterCharacter ?? getPipelineInputText(session, 1);
    const prompt = buildCharacterTraitsOutlineUserPrompt({
      sourceText,
      personaBlock,
    });
    const traceId = makePipelineTraceId('character-traits-outline');
    session.traceIds.characterTraitsOutline = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_character_traits_outline',
    });
    callbacks.onStage?.({ stage: 'pipeline_character_traits_outline' });

    logPipelinePlainTextDebug({
      module: 'character-traits-outline（请求前）',
      traceId,
      projectId: session.projectId,
      chapterNo: session.chapterNo,
      templateKey: CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
      selectedPersonaNames: session.selectedPersonaNames,
      resolvedPersonaNames: resolvedPersonas.map((persona) => persona.name),
      personaBlock,
      userPrompt: prompt,
    });

    const raw = await this.generatePipelineTextViaStream({
      projectId: session.projectId,
      prompt,
      templateKey: CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
      context: {
        task: 'chapter.pipeline.character-traits.outline',
        chapterNo: session.chapterNo,
        traceId,
      },
    });

    logPipelinePlainTextDebug({
      module: 'character-traits-outline（返回后）',
      traceId,
      projectId: session.projectId,
      chapterNo: session.chapterNo,
      templateKey: CHAPTER_PIPELINE_CHARACTER_TRAITS_OUTLINE_TEMPLATE_KEY,
      selectedPersonaNames: session.selectedPersonaNames,
      resolvedPersonaNames: resolvedPersonas.map((persona) => persona.name),
      personaBlock,
      userPrompt: prompt,
      rawResponse: raw,
    });

    try {
      const parsed = parsePipelineOutlineJson(raw);
      const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
      const sanitized = sanitizeSensoryOutlineWithContentScan(
        parsed,
        rules,
        settings.contentSafetyScanEnabled !== false
      );
      session.characterTraitsOutline = {
        ...sanitized,
        userConfirmed: session.config.pipelineSkipCharacterTraitsOutlineReview,
        revisionRound: 0,
        revisionHistory: [],
      };
      putPipelineSession(session);
      if (isPipelinePromptLoggingEnabled()) {
        console.log(
          `[api/chapter-pipeline] character-traits-outline parsed required=${session.characterTraitsOutline.required.length} suggested=${session.characterTraitsOutline.suggested.length}`
        );
      }
      callbacks.onEnd?.({
        traceId,
        characterTraitsOutline: session.characterTraitsOutline,
        currentModule: 1,
      });
    } catch {
      callbacks.onError?.('角色特征润色大纲 JSON 解析失败');
      throw new ChapterPipelineModuleFailedError(
        '角色特征润色大纲 JSON 解析失败',
        'character-traits-outline'
      );
    }
  }

  private async runCharacterTraitsModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    const outline = session.characterTraitsOutline;
    if (!outline) {
      throw new ChapterPipelineGateNotConfirmedError('角色特征润色大纲尚未生成');
    }
    if (!outline.userConfirmed && !session.config.pipelineSkipCharacterTraitsOutlineReview) {
      throw new ChapterPipelineGateNotConfirmedError('角色特征润色大纲尚未确认');
    }

    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const sourceText = session.versions.afterCharacter ?? getPipelineInputText(session, 1);
    const allItems = [...outline.required, ...outline.suggested];
    const prompt = buildCharacterTraitsRewriteUserPrompt({
      sourceText,
      outline: allItems,
      personaBlock: this.buildPersonaBlock(personas, session),
    });
    const traceId = makePipelineTraceId('character-traits');
    session.traceIds.characterTraits = traceId;

    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_character_traits',
    });
    callbacks.onStage?.({ stage: 'pipeline_character_traits' });

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
        templateKey: CHAPTER_PIPELINE_CHARACTER_TRAITS_TEMPLATE_KEY,
        context: {
          task: 'chapter.pipeline.character-traits',
          chapterNo: session.chapterNo,
          traceId,
          segmentIndex: i,
          segmentTotal: segments.length,
          retrievalChapterTitle: chapter?.title ?? '',
        },
        callbacks: { onContent: callbacks.onContent },
      });
      if (!result.ok) {
        callbacks.onError?.(result.errorMessage || '角色特征润色失败');
        throw new ChapterPipelineModuleFailedError(
          result.errorMessage || '角色特征润色失败',
          'character-traits'
        );
      }
      segmentTexts.push(result.text);
    }

    const merged =
      segmentTexts.length > 1 ? mergeSegmentDraftTexts(segmentTexts) : segmentTexts[0] ?? '';
    session.versions.afterCharacterTraits = merged;
    session.currentModule = 2;
    putPipelineSession(session);
    callbacks.onEnd?.({
      traceId,
      versionText: merged,
      versionKey: 'afterCharacterTraits',
      currentModule: 2,
    });
  }

  private async runSensoryOutlineModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks
  ): Promise<void> {
    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 2);
    const prompt = buildSensoryOutlineUserPrompt({
      sourceText,
      personaBlock: this.buildPersonaBlock(personas, session),
    });
    const traceId = makePipelineTraceId('sensory-outline');
    session.traceIds.sensoryOutline = traceId;

    callbacks.onStart?.({ traceId, chapterNo: session.chapterNo, stage: 'pipeline_sensory_outline' });
    callbacks.onStage?.({ stage: 'pipeline_sensory_outline' });

    const raw = await this.generatePipelineTextViaStream({
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
        revisionRound: session.sensoryOutline?.revisionRound ?? 0,
        revisionHistory: session.sensoryOutline?.revisionHistory ?? [],
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

    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const sourceText = getPipelineInputText(session, 2);
    const allItems = [...outline.required, ...outline.suggested];
    const prompt = buildSensoryRewriteUserPrompt({
      sourceText,
      outline: allItems,
      personaBlock: this.buildPersonaBlock(personas, session),
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
    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
    const protagonistName = protagonist?.name ?? '主角';
    const personaBlock = this.buildPersonaBlock(personas, session);
    const sourceText = getPipelineInputText(session, 3);
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const deterministic = scanPipelineRules(
      sourceText,
      rules,
      settings.contentSafetyScanEnabled !== false,
      session.config.pipelineRulesFixMode
    );

    callbacks.onStart?.({
      traceId: makePipelineTraceId('rules-scan'),
      chapterNo: session.chapterNo,
      stage: 'pipeline_rules_scan',
    });
    callbacks.onStage?.({ stage: 'pipeline_rules_scan' });

    let llmIssues: PipelineRuleIssue[] = [];
    try {
      const raw = await this.generatePipelineTextViaStream({
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
        raw = await this.generatePipelineTextViaStream({
          projectId: session.projectId,
          prompt: fixPrompt,
          templateKey: CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
          context: {
            task: 'chapter.pipeline.rules.fix',
            chapterNo: session.chapterNo,
            issueId: issue.id,
          },
          maxTokens: PIPELINE_RULE_FIX_MAX_TOKENS,
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
    await this.prepareContext(session);
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
      raw = await this.generatePipelineTextViaStream({
        projectId: session.projectId,
        prompt: fixPrompt,
        templateKey: CHAPTER_PIPELINE_RULES_FIX_TEMPLATE_KEY,
        context: {
          task: 'chapter.pipeline.rules.fix',
          chapterNo: session.chapterNo,
          issueId,
        },
        maxTokens: PIPELINE_RULE_FIX_MAX_TOKENS,
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
    await this.prepareContext(session);
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

    const raw = await this.generatePipelineTextViaStream({
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
    await this.prepareContext(session);
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

  private async runFinalPolishModule(
    session: ChapterPipelineSession,
    userId: string | undefined,
    callbacks: PipelineStreamCallbacks,
    options?: { forceRegenerate?: boolean }
  ): Promise<void> {
    await this.prepareContext(session);
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
    const protagonistRules =
      (settings as { protagonistProgressRules?: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES })
        .protagonistProgressRules ?? DEFAULT_PROTAGONIST_PROGRESS_RULES;
    const rules = mergeContentSafetyRules(settings.contentSafetyCustomRules ?? []);
    const scanEnabled = settings.contentSafetyScanEnabled !== false;
    const fingerprint = this.buildFinalPolishFingerprint(
      session,
      settings,
      personas,
      protagonistRules,
      rules,
      scanEnabled
    );

    if (!options?.forceRegenerate) {
      const cached = getFinalPolishCache(session.projectId, session.chapterNo, fingerprint);
      if (cached?.versionText?.trim()) {
        const traceId = makePipelineTraceId('final-polish-cache');
        session.traceIds.finalPolish = traceId;
        callbacks.onStart?.({
          traceId,
          chapterNo: session.chapterNo,
          stage: 'pipeline_final_polish_done',
        });
        callbacks.onStage?.({ stage: 'pipeline_final_polish_done' });
        this.applyFinalPolishResult(session, {
          ...cached,
          cached: true,
          traceIds: { ...cached.traceIds, cache: traceId },
        });
        putPipelineSession(session);
        callbacks.onEnd?.({
          traceId,
          versionText: cached.versionText,
          versionKey: 'final',
          currentModule: 'done',
          finalPolishResult: session.finalPolishResult,
          cachedFromFingerprint: true,
        });
        return;
      }
    } else {
      session.versions = { original: session.sourceText };
      session.characterOutline = undefined;
      session.characterTraitsOutline = undefined;
      session.sensoryOutline = undefined;
      session.ruleIssues = undefined;
      session.homogenizationReport = undefined;
      session.finalPolishResult = undefined;
      session.currentModule = session.config.pipelineEnabledModules[0] ?? 1;
      putPipelineSession(session);
    }

    const traceId = makePipelineTraceId('final-polish-pipeline');
    session.traceIds.finalPolish = traceId;
    callbacks.onStart?.({
      traceId,
      chapterNo: session.chapterNo,
      stage: 'pipeline_character',
    });

    let pipelineInterrupted = false;
    await this.runAllModules(session, userId, {
      onStart: callbacks.onStart,
      onStage: callbacks.onStage,
      onContent: callbacks.onContent,
      onError: (message) => {
        pipelineInterrupted = true;
        callbacks.onError?.(message);
      },
      onGate: () => {
        pipelineInterrupted = true;
        callbacks.onError?.(
          '一键终稿不应中断于大纲 gate；请在设置中开启「跳过大纲审核」或联系管理员'
        );
      },
    });

    if (pipelineInterrupted || session.currentModule !== 'done') {
      return;
    }

    const draftText = resolvePipelineApplyText(session, 'final');
    if (!draftText.trim()) {
      callbacks.onError?.('终稿流水线未产出正文');
      return;
    }

    if (!session.versions.final?.trim()) {
      session.versions.final = draftText;
    }

    const protagonistName = protagonist?.name ?? '主角';
    const residualIssues = sanitizeRuleIssuesForText(
      draftText,
      session.ruleIssues ??
        relocateRuleIssuesInText(
          draftText,
          scanPipelineRules(draftText, rules, scanEnabled, 'semi')
        )
    );

    callbacks.onStage?.({ stage: 'pipeline_final_polish_done' });

    const finalPolishResult: FinalPolishResult = {
      fingerprint,
      versionText: draftText,
      residualIssues,
      qualityStatus: resolveFinalPolishQualityStatus(residualIssues),
      traceIds: {
        pipeline: traceId,
        ...session.traceIds,
      },
      createdAt: new Date().toISOString(),
      cached: false,
    };

    this.applyFinalPolishResult(session, finalPolishResult);
    putFinalPolishCache(session.projectId, session.chapterNo, finalPolishResult);
    putPipelineSession(session);

    callbacks.onEnd?.({
      traceId,
      versionText: draftText,
      versionKey: 'final',
      currentModule: 'done',
      finalPolishResult: session.finalPolishResult,
      cachedFromFingerprint: false,
    });
  }

  private buildFinalPolishFingerprint(
    session: ChapterPipelineSession,
    settings: ReturnType<ProjectsService['getSettings']>,
    personas: PersonaRecord[],
    protagonistRules: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES,
    rules: ReturnType<typeof mergeContentSafetyRules>,
    scanEnabled: boolean
  ): string {
    return computeFinalPolishFingerprint({
      chapterContent: session.versions.original,
      chapterUpdatedAt: session.sourceUpdatedAt,
      personasFingerprint: computePersonasFingerprint(
        personas.map((persona) => ({
          id: persona.id,
          name: persona.name,
          profile: persona.profile,
          state: persona.state,
          status: persona.status,
          chapterStates: persona.chapterStates?.map((state) => ({
            chapterNo: state.chapterNo,
            appearance: state.snapshot?.appearance,
            state: state.snapshot?.status ?? state.summaryLine,
          })),
        }))
      ),
      systemPromptFingerprint: hashFingerprintPart(settings.systemPromptText ?? ''),
      pipelineEngineFingerprint: hashFingerprintPart(
        JSON.stringify({
          engine: 'silent-run-all-v3',
          modules: session.config.pipelineEnabledModules,
          skipCharacterOutline: session.config.pipelineSkipCharacterOutlineReview,
          skipCharacterTraitsOutline: session.config.pipelineSkipCharacterTraitsOutlineReview,
          characterTraitsEnabled: session.config.pipelineCharacterTraitsEnabled,
          skipSensoryOutline: session.config.pipelineSkipSensoryOutlineReview,
          rulesFixMode: session.config.pipelineRulesFixMode,
          homogenization: session.config.pipelineHomogenizationEnabled,
        })
      ),
      contentSafetyRulesFingerprint: computeContentSafetyRulesFingerprint(rules),
      finalPolishConfigFingerprint: hashFingerprintPart(
        JSON.stringify({
          contentSafetyScanEnabled: scanEnabled,
          protagonistProgressRules: protagonistRules,
        })
      ),
      segmentConfigFingerprint: hashFingerprintPart(
        String(settings.chapterOptimizeSegmentCharSize ?? '')
      ),
    });
  }

  private applyFinalPolishResult(
    session: ChapterPipelineSession,
    result: FinalPolishResult
  ): void {
    session.versions.final = result.versionText;
    session.finalPolishResult = result;
    session.ruleIssues = result.residualIssues;
    session.currentModule = 'done';
    session.traceIds.finalPolish = result.traceIds.generate;
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

  private async prepareContext(session: ChapterPipelineSession): Promise<void> {
    await this.projectsService.syncContextForChapterPipeline(session.projectId, session.userId, {
      appearingCharacters: session.selectedPersonaNames,
    });
  }

  private resolveSessionPersonas(
    session: ChapterPipelineSession,
    personas: PersonaRecord[]
  ): PersonaRecord[] {
    return filterPipelinePersonas(personas, session.selectedPersonaNames);
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

  private buildPersonaBlock(personas: PersonaRecord[], session: ChapterPipelineSession): string {
    return this.resolveSessionPersonas(session, personas)
      .map((p) => `${p.name}：${p.profile}\n状态：${p.state}`)
      .join('\n\n');
  }

  private buildOutlineBaseUserPrompt(
    session: ChapterPipelineSession,
    outlineType: ChapterPipelineOutlineType,
    userId?: string
  ): string {
    const settings = this.projectsService.getSettings(session.projectId, userId);
    const personas = this.projectsService.getPersonas(session.projectId, userId);
    const personaBlock = this.buildPersonaBlock(personas, session);
    const sourceText = resolveOutlineSourceText(session, outlineType);

    if (outlineType === 'character') {
      const protagonist = this.resolveProtagonist(personas, settings.activePersonaId);
      const protagonistRules =
        (settings as { protagonistProgressRules?: typeof DEFAULT_PROTAGONIST_PROGRESS_RULES })
          .protagonistProgressRules ?? DEFAULT_PROTAGONIST_PROGRESS_RULES;
      const protagonistContext = resolveProtagonistContext(
        session.chapterNo,
        protagonistRules,
        protagonist
      );
      return buildCharacterOutlineUserPrompt({
        sourceText,
        protagonistContext,
        personaBlock,
      });
    }

    if (outlineType === 'character-traits') {
      return buildCharacterTraitsOutlineUserPrompt({
        sourceText,
        personaBlock,
      });
    }

    return buildSensoryOutlineUserPrompt({
      sourceText,
      personaBlock,
    });
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
      pipelineSkipCharacterOutlineReview:
        ext.pipelineSkipCharacterOutlineReview ??
        DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterOutlineReview,
      pipelineSkipCharacterTraitsOutlineReview:
        ext.pipelineSkipCharacterTraitsOutlineReview ??
        DEFAULT_PIPELINE_CONFIG.pipelineSkipCharacterTraitsOutlineReview,
      pipelineCharacterTraitsEnabled:
        ext.pipelineCharacterTraitsEnabled ?? DEFAULT_PIPELINE_CONFIG.pipelineCharacterTraitsEnabled,
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
  onGate?: (
    gate: ChapterPipelineOutlineGate,
    payload?: {
      characterOutline?: ChapterPipelineSession['characterOutline'];
      characterTraitsOutline?: ChapterPipelineSession['characterTraitsOutline'];
      sensoryOutline?: ChapterPipelineSession['sensoryOutline'];
    }
  ) => void;
}
