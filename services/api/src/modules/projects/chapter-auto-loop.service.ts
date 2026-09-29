/**
 * 章节自动优化循环服务（openspec: add-chapter-auto-optimize-loop）
 *
 * 只负责接线：把引擎的 diagnose / rewriteSegment 依赖接到 orchestrator，
 * 把引擎事件转成 SSE 回调，并把结果写进会话以扛前端刷新。
 * 循环控制逻辑与闸门判定全在 `chapter-auto-loop.engine` / `.util`，便于单测。
 */

import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  streamPipelineGeneration,
  generatePipelinePlainText,
} from './chapter-generation-stream.client';
import { resolveUpstreamFailureMessage } from './orchestrator-error.util';
import {
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
  buildAutoLoopPlanUserPrompt,
  buildAutoLoopSegmentUserPrompt,
  clampAutoLoopRoundBudget,
  resolveAutoLoopPersonaNames,
  resolveAutoLoopSegmentMaxTokens,
  appendAutoLoopDiagnoseRetryHint,
} from './chapter-auto-loop.util';
import { buildChapterPersonaPromptBlock } from './chapter-persona-prompt.util';
import {
  composeAutoLoopResumeDraft,
  composeAutoLoopTimelineRounds,
  runChapterAutoLoopWindows,
  summarizeAutoLoopResume,
  synthesizeAutoLoopResume,
} from './chapter-auto-loop.engine';
import type {
  AutoLoopEngineEvent,
  AutoLoopResult,
  AutoLoopResumeState,
  AutoLoopResumeSummary,
} from './chapter-auto-loop.engine';
import {
  getAutoLoopSession,
  putAutoLoopSession,
  toPublicAutoLoopSession,
} from './chapter-auto-loop-session.store';
import type { PublicChapterAutoLoopSession } from './chapter-auto-loop-session.store';
import {
  assertInstruction,
  makeOptimizationId,
  normalizeInstruction,
  resolveChapterOptimizeConfigWithProjectOverride,
} from './chapter-optimize.util';
import { ProjectsService } from './projects.service';
import { TaskPromptsService } from '../task-prompts/task-prompts.service';
import {
  attachPromptLabCallIds,
  attachPromptLabCallIdToItem,
  buildPromptLabAdviseRequest,
  buildPromptLabReplayRequest,
  makePromptLabCallId,
  parseAdviseResponse,
  type AutoLoopPromptLabCall,
} from './chapter-auto-loop-prompt-lab';

export type ChapterAutoLoopStage =
  | 'syncing_context'
  | 'loop_diagnose'
  | 'loop_segment_rewrite'
  | 'loop_round_gate';

const DIAGNOSE_MAX_TOKENS = 4096;

export interface ChapterAutoLoopStreamCallbacks {
  onStart: (event: {
    traceId: string;
    chapterNo: number;
    roundBudget: number;
    baseUpdatedAt: string;
  }) => void;
  onStage?: (event: {
    stage: ChapterAutoLoopStage;
    roundIndex?: number;
    segmentIndex?: number;
    segmentTotal?: number;
    windowIndex?: number;
    windowTotal?: number;
  }) => void;
  onEngineEvent: (event: AutoLoopEngineEvent) => void;
  onPromptLabCall?: (call: AutoLoopPromptLabCall) => void;
  onEnd: (
    event: {
      traceId: string;
      finalDraftText: string;
      stoppedReason: AutoLoopResult['stoppedReason'];
      roundCount: number;
      baseUpdatedAt: string;
    } & AutoLoopResumeSummary
  ) => void;
  onError: (message: string) => void;
}

function composeCheckpointRounds(resume: AutoLoopResumeState): AutoLoopResult['rounds'] {
  return composeAutoLoopTimelineRounds(resume);
}

@Injectable()
export class ChapterAutoLoopService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly taskPromptsService: TaskPromptsService
  ) {}

  getSession(
    projectId: string,
    chapterNo: number,
    userId?: string
  ): PublicChapterAutoLoopSession | null {
    // 触发一次访问校验，避免越权读会话
    this.projectsService.getSettings(projectId, userId);
    const session = getAutoLoopSession(projectId, chapterNo, userId);
    if (!session) {
      return null;
    }
    const publicSession = toPublicAutoLoopSession(session);
    if (publicSession.resumable) {
      return publicSession;
    }
    const synthesized = synthesizeAutoLoopResume(session);
    if (!synthesized) {
      return publicSession;
    }
    return {
      ...publicSession,
      ...summarizeAutoLoopResume(synthesized),
    };
  }

  async runStream(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction?: string;
      roundBudget?: number;
      appearingCharacters?: string[];
      resume?: boolean;
    },
    userId: string | undefined,
    callbacks: ChapterAutoLoopStreamCallbacks,
    isAborted: () => boolean,
    abortSignal?: AbortSignal
  ): Promise<void> {
    const settings = this.projectsService.getSettings(projectId, userId);
    const optimizeConfig = resolveChapterOptimizeConfigWithProjectOverride(
      settings.chapterOptimizeSegmentCharSize
    );
    const windowing = {
      segmentCharSize: optimizeConfig.segmentationEnabled ? optimizeConfig.segmentCharSize : 0,
      singleSegmentThreshold: optimizeConfig.singleSegmentThreshold,
    };

    const chapter = this.projectsService.getChapterRecordForPipeline(projectId, chapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到第${chapterNo}章`);
    }
    if (!chapter.content?.trim()) {
      throw new BadRequestException(`第${chapterNo}章正文为空，无法优化`);
    }

    const existingSession = getAutoLoopSession(projectId, chapterNo, userId);
    const resumeState = existingSession ? synthesizeAutoLoopResume(existingSession) : undefined;
    const resumeRequested = payload.resume === true && Boolean(resumeState);

    const instruction = normalizeInstruction(
      payload.instruction?.trim()
        ? payload.instruction
        : resumeRequested
          ? existingSession?.instruction
          : payload.instruction
    );
    assertInstruction(instruction);
    const roundBudget = clampAutoLoopRoundBudget(
      payload.roundBudget ?? (resumeRequested ? existingSession?.roundBudget : undefined)
    );
    const storedContent =
      resumeRequested && existingSession ? existingSession.storedContent : chapter.content;
    const baseUpdatedAt =
      resumeRequested && existingSession
        ? existingSession.baseUpdatedAt
        : chapter.updatedAt.toISOString();
    const traceId = makeOptimizationId('auto-loop');
    const { names: appearingCharacters, block: personaBlock } = this.resolveLoopPersonas({
      projectId,
      chapterNo,
      sourceText: storedContent,
      requestedNames: payload.appearingCharacters,
      userId,
    });
    const chapterSummaryForRetrieval =
      (typeof chapter.summary === 'string' && chapter.summary.trim()) ||
      chapter.content.slice(0, 160);
    const retrievalContext = {
      retrievalInstruction: instruction,
      retrievalChapterSummary: chapterSummaryForRetrieval,
      retrievalChapterTitle: chapter.title,
      ...(appearingCharacters.length ? { appearingCharacters } : {}),
    };

    callbacks.onStage?.({ stage: 'syncing_context' });
    await this.projectsService.syncContextForChapterPipeline(projectId, userId, {
      ...(appearingCharacters.length ? { appearingCharacters } : {}),
    });

    callbacks.onStart({ traceId, chapterNo, roundBudget, baseUpdatedAt });

    const orchestratorUrl = this.projectsService.getRagOrchestratorUrlForPipeline();
    const promptLabCalls: AutoLoopPromptLabCall[] = resumeRequested
      ? [...(existingSession?.promptLabCalls ?? [])]
      : [];

    const persistSession = (input: {
      rounds: AutoLoopResult['rounds'];
      finalDraft: string;
      stoppedReason: AutoLoopResult['stoppedReason'];
      resume?: AutoLoopResult['resume'];
      errorMessage?: string;
    }) => {
      const now = new Date();
      const current = getAutoLoopSession(projectId, chapterNo, userId);
      putAutoLoopSession({
        projectId,
        chapterNo,
        userId,
        instruction,
        roundBudget,
        baseUpdatedAt,
        storedContent,
        rounds: input.rounds.map((round) => attachPromptLabCallIds(round, promptLabCalls)),
        finalDraft: input.finalDraft,
        stoppedReason: input.stoppedReason,
        errorMessage: input.errorMessage,
        resume: input.resume,
        promptLabCalls: [...promptLabCalls],
        createdAt: current?.createdAt ?? existingSession?.createdAt ?? now,
        updatedAt: now,
      });
    };

    const recordPromptLabCall = (
      kind: AutoLoopPromptLabCall['kind'],
      input: {
        roundIndex: number;
        paragraphIndex?: number;
        userPrompt: string;
        output: string;
        frozenRetrievedEvidence: string;
        templateKey: string;
      }
    ) => {
      const call: AutoLoopPromptLabCall = {
        id: makePromptLabCallId(kind),
        kind,
        templateKey: input.templateKey,
        roundIndex: input.roundIndex,
        ...(currentWindowIndex ? { windowIndex: currentWindowIndex } : {}),
        ...(currentWindowTotal ? { windowTotal: currentWindowTotal } : {}),
        ...(input.paragraphIndex ? { paragraphIndex: input.paragraphIndex } : {}),
        userPrompt: input.userPrompt,
        taskPromptText: this.taskPromptsService.resolveTaskSystemPrompt(
          projectId,
          input.templateKey
        ),
        output: input.output,
        frozenRetrievedEvidence: input.frozenRetrievedEvidence,
        createdAt: new Date().toISOString(),
      };
      promptLabCalls.push(call);
      callbacks.onPromptLabCall?.(call);
      return call;
    };

    let currentWindowIndex: number | undefined;
    let currentWindowTotal: number | undefined;

    const result = await runChapterAutoLoopWindows({
      storedContent,
      instruction,
      roundBudget,
      windowing,
      ...(resumeRequested && resumeState ? { resume: resumeState } : {}),
      deps: {
        isAborted,
        diagnose: async (input) => {
          if (isAborted()) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          }
          callbacks.onStage?.({
            stage: 'loop_diagnose',
            roundIndex: input.roundIndex,
            windowIndex: currentWindowIndex,
            windowTotal: currentWindowTotal,
          });
          const basePrompt = buildAutoLoopPlanUserPrompt({
            instruction,
            chapterNo,
            chapterTitle: chapter.title,
            indexedBody: input.indexedBody,
            roundIndex: input.roundIndex,
            roundBudget: input.roundBudget,
            previousItems: input.previousItems,
            personaBlock,
            ...(input.previousWindowTail ? { previousWindowTail: input.previousWindowTail } : {}),
          });
          const prompt =
            (input.retryCount ?? 0) > 0 ? appendAutoLoopDiagnoseRetryHint(basePrompt) : basePrompt;
          const response = await streamPipelineGeneration({
            orchestratorUrl,
            projectId,
            prompt,
            templateKey: CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
            maxTokens: DIAGNOSE_MAX_TOKENS,
            context: {
              task: CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
              chapterNo,
              traceId,
              roundIndex: input.roundIndex,
              ...retrievalContext,
              ...(currentWindowIndex ? { windowIndex: currentWindowIndex } : {}),
              ...(currentWindowTotal ? { windowTotal: currentWindowTotal } : {}),
            },
            callbacks: {},
            ...(abortSignal ? { signal: abortSignal } : {}),
          });
          if (isAborted() || response.aborted) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          }
          if (!response.ok) {
            throw new Error(response.errorMessage || '循环复诊生成失败');
          }
          recordPromptLabCall('diagnose', {
            roundIndex: input.roundIndex,
            userPrompt: prompt,
            output: response.text,
            frozenRetrievedEvidence: response.retrievedEvidence ?? '',
            templateKey: CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
          });
          return response.text;
        },
        rewriteSegment: async (input) => {
          if (isAborted()) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          }
          const prompt = buildAutoLoopSegmentUserPrompt({
            instruction,
            paragraphIndex: input.paragraphIndex,
            originalParagraph: input.originalParagraph,
            previousParagraph: input.previousParagraph,
            nextParagraph: input.nextParagraph,
            precedingText: input.precedingText,
            followingText: input.followingText,
            items: input.items,
            personaBlock,
          });
          const response = await streamPipelineGeneration({
            orchestratorUrl,
            projectId,
            prompt,
            templateKey: CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
            maxTokens: resolveAutoLoopSegmentMaxTokens(input.originalParagraph),
            context: {
              task: CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
              chapterNo,
              traceId,
              roundIndex: input.roundIndex,
              paragraphIndex: input.paragraphIndex,
              ...retrievalContext,
              ...(currentWindowIndex ? { windowIndex: currentWindowIndex } : {}),
              ...(currentWindowTotal ? { windowTotal: currentWindowTotal } : {}),
            },
            callbacks: {},
            ...(abortSignal ? { signal: abortSignal } : {}),
          });
          if (isAborted() || response.aborted) {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          }
          if (!response.ok) {
            throw new Error(response.errorMessage || '段落改写生成失败');
          }
          recordPromptLabCall('rewrite', {
            roundIndex: input.roundIndex,
            paragraphIndex: input.paragraphIndex,
            userPrompt: prompt,
            output: response.text,
            frozenRetrievedEvidence: response.retrievedEvidence ?? '',
            templateKey: CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
          });
          return response.text;
        },
      },
      onEvent: (event) => {
        if (event.type === 'window_start') {
          currentWindowIndex = event.windowIndex;
          currentWindowTotal = event.windowTotal;
        } else if (event.windowIndex && event.windowTotal) {
          currentWindowIndex = event.windowIndex;
          currentWindowTotal = event.windowTotal;
        }
        if (event.type === 'round_end') {
          callbacks.onStage?.({
            stage: 'loop_round_gate',
            roundIndex: event.roundIndex,
            windowIndex: event.windowIndex ?? currentWindowIndex,
            windowTotal: event.windowTotal ?? currentWindowTotal,
          });
        }
        if (event.type === 'round_end') {
          callbacks.onEngineEvent({
            ...event,
            round: attachPromptLabCallIds(event.round, promptLabCalls),
          });
          return;
        }
        if (event.type === 'item_status') {
          callbacks.onEngineEvent({
            ...event,
            item: attachPromptLabCallIdToItem(event.item, promptLabCalls, {
              roundIndex: event.roundIndex,
              windowIndex: event.windowIndex ?? currentWindowIndex,
            }),
          });
          return;
        }
        callbacks.onEngineEvent(event);
      },
      onCheckpoint: (resume) => {
        persistSession({
          rounds: composeCheckpointRounds(resume),
          finalDraft: composeAutoLoopResumeDraft(resume, storedContent),
          stoppedReason: 'aborted',
          resume,
        });
      },
    });

    const resumeSummary = summarizeAutoLoopResume(result.resume);
    const parseFailedMessage = '循环复诊未返回可解析的条目，已保留当前稿，可从失败处继续';
    persistSession({
      rounds: result.rounds,
      finalDraft: result.finalDraft,
      stoppedReason: result.stoppedReason,
      resume: result.resume,
      ...(result.stoppedReason === 'plan_parse_failed' ? { errorMessage: parseFailedMessage } : {}),
    });

    callbacks.onEnd({
      traceId,
      finalDraftText: result.finalDraft,
      stoppedReason: result.stoppedReason,
      roundCount: result.rounds.length,
      baseUpdatedAt,
      resumable: resumeSummary.resumable,
      resumeStage: resumeSummary.resumeStage,
      resumeRoundIndex: resumeSummary.resumeRoundIndex,
      resumeSegmentIndex: resumeSummary.resumeSegmentIndex,
      resumeSegmentTotal: resumeSummary.resumeSegmentTotal,
      resumeWindowIndex: resumeSummary.resumeWindowIndex,
      resumeWindowTotal: resumeSummary.resumeWindowTotal,
    });
    if (result.stoppedReason === 'plan_parse_failed') {
      callbacks.onError(parseFailedMessage);
    }
  }

  getPromptLabCall(
    projectId: string,
    chapterNo: number,
    callId: string,
    userId?: string
  ): AutoLoopPromptLabCall {
    const session = this.requireSession(projectId, chapterNo, userId);
    const call = session.promptLabCalls?.find((item) => item.id === callId);
    if (!call) {
      throw new BadRequestException('没有这次生成的实验室快照，请先跑完对应的诊断或改写');
    }
    return call;
  }

  async replayPromptLab(
    projectId: string,
    chapterNo: number,
    callId: string,
    taskPromptText: string,
    userId?: string,
    projectSystemPromptText?: string
  ): Promise<{ output: string }> {
    const call = this.getPromptLabCall(projectId, chapterNo, callId, userId);
    const override = taskPromptText.trim();
    if (!override) {
      throw new BadRequestException('任务 Prompt 不能为空');
    }
    const orchestratorUrl = this.projectsService.getRagOrchestratorUrlForPipeline();
    const replay = buildPromptLabReplayRequest(call, override, projectSystemPromptText);
    let output = '';
    try {
      output = await generatePipelinePlainText({
        orchestratorUrl,
        projectId,
        prompt: replay.prompt,
        templateKey: replay.templateKey,
        systemPromptOverride: replay.systemPromptOverride,
        context: {
          ...replay.context,
          chapterNo,
        },
      });
    } catch (error) {
      throw new BadGatewayException(await resolveUpstreamFailureMessage(error, '重跑失败'));
    }
    if (!output.trim()) {
      throw new BadRequestException('重跑未返回有效文本');
    }
    return { output };
  }

  async advisePromptLab(
    projectId: string,
    chapterNo: number,
    payload: {
      callId: string;
      taskPromptText: string;
      projectSystemText?: string;
      message: string;
      latestReplayOutput?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    userId?: string
  ) {
    const call = this.getPromptLabCall(projectId, chapterNo, payload.callId, userId);
    const message = payload.message.trim();
    if (!message) {
      throw new BadRequestException('请先写下这次输出哪里不好');
    }
    const orchestratorUrl = this.projectsService.getRagOrchestratorUrlForPipeline();
    const advise = buildPromptLabAdviseRequest({
      userPrompt: call.userPrompt,
      originalOutput: call.output,
      latestReplayOutput: payload.latestReplayOutput,
      projectSystemText: payload.projectSystemText ?? '',
      taskPromptText: payload.taskPromptText,
      message,
      history: payload.history ?? [],
    });
    let output = '';
    try {
      output = await generatePipelinePlainText({
        orchestratorUrl,
        projectId,
        prompt: advise.prompt,
        templateKey: advise.templateKey,
        systemPromptOverride: advise.systemPromptOverride,
        context: {
          ...advise.context,
          chapterNo,
        },
      });
    } catch (error) {
      throw new BadGatewayException(await resolveUpstreamFailureMessage(error, '顾问调用失败'));
    }
    if (!output.trim()) {
      throw new BadRequestException('顾问未返回有效文本');
    }
    try {
      return parseAdviseResponse(output);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '顾问未返回可解析的任务 Prompt'
      );
    }
  }

  private requireSession(projectId: string, chapterNo: number, userId?: string) {
    this.projectsService.getSettings(projectId, userId);
    const session = getAutoLoopSession(projectId, chapterNo, userId);
    if (!session) {
      throw new NotFoundException('没有可恢复的自动优化会话');
    }
    return session;
  }

  private resolveLoopPersonas(input: {
    projectId: string;
    chapterNo: number;
    sourceText: string;
    requestedNames?: string[];
    userId?: string;
  }): { names: string[]; block: string } {
    const personas = this.projectsService.getPersonas(input.projectId, input.userId);
    const requested = (input.requestedNames ?? []).map((name) => name.trim()).filter(Boolean);
    const names = resolveAutoLoopPersonaNames({
      sourceText: input.sourceText,
      personas,
      requestedNames: requested,
    });
    if (names.length === 0) {
      return { names: [], block: '' };
    }
    const cards = this.projectsService.listPersonaCardDocuments(input.projectId, input.userId);
    return {
      names,
      block: buildChapterPersonaPromptBlock(personas, names, {
        cards,
        ...(requested.length > 0 ? {} : { sourceText: input.sourceText }),
      }),
    };
  }
}
