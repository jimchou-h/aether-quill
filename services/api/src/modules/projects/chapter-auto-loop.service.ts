/**
 * 章节自动优化循环服务（openspec: add-chapter-auto-optimize-loop）
 *
 * 只负责接线：把引擎的 diagnose / rewriteSegment 依赖接到 orchestrator，
 * 把引擎事件转成 SSE 回调，并把结果写进会话以扛前端刷新。
 * 循环控制逻辑与闸门判定全在 `chapter-auto-loop.engine` / `.util`，便于单测。
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { streamPipelineGeneration } from './chapter-pipeline-orchestrator.client';
import {
  CHAPTER_AUTO_LOOP_DRAFT_TEMPLATE_KEY,
  CHAPTER_AUTO_LOOP_PLAN_TEMPLATE_KEY,
  buildAutoLoopPlanUserPrompt,
  buildAutoLoopSegmentUserPrompt,
  clampAutoLoopRoundBudget,
  formatAutoLoopPersonaBlock,
  resolveAutoLoopSegmentMaxTokens,
} from './chapter-auto-loop.util';
import { runChapterAutoLoop } from './chapter-auto-loop.engine';
import type { AutoLoopEngineEvent, AutoLoopResult } from './chapter-auto-loop.engine';
import { getAutoLoopSession, putAutoLoopSession } from './chapter-auto-loop-session.store';
import type { ChapterAutoLoopSession } from './chapter-auto-loop-session.store';
import {
  assertInstruction,
  makeOptimizationId,
  normalizeInstruction,
} from './chapter-optimize.util';
import { ProjectsService } from './projects.service';

export type ChapterAutoLoopStage =
  | 'syncing_context'
  | 'loop_diagnose'
  | 'loop_segment_rewrite'
  | 'loop_round_gate';

const DIAGNOSE_MAX_TOKENS = 2400;

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
  }) => void;
  onEngineEvent: (event: AutoLoopEngineEvent) => void;
  onEnd: (event: {
    traceId: string;
    finalDraftText: string;
    stoppedReason: AutoLoopResult['stoppedReason'];
    roundCount: number;
    baseUpdatedAt: string;
  }) => void;
  onError: (message: string) => void;
}

@Injectable()
export class ChapterAutoLoopService {
  constructor(private readonly projectsService: ProjectsService) {}

  getSession(projectId: string, chapterNo: number, userId?: string): ChapterAutoLoopSession | null {
    // 触发一次访问校验，避免越权读会话
    this.projectsService.getSettings(projectId, userId);
    return getAutoLoopSession(projectId, chapterNo, userId) ?? null;
  }

  async runStream(
    projectId: string,
    chapterNo: number,
    payload: {
      instruction?: string;
      roundBudget?: number;
      appearingCharacters?: string[];
    },
    userId: string | undefined,
    callbacks: ChapterAutoLoopStreamCallbacks,
    isAborted: () => boolean
  ): Promise<void> {
    this.projectsService.getSettings(projectId, userId);

    const chapter = this.projectsService.getChapterRecordForPipeline(projectId, chapterNo);
    if (!chapter) {
      throw new NotFoundException(`未找到第${chapterNo}章`);
    }
    if (!chapter.content?.trim()) {
      throw new BadRequestException(`第${chapterNo}章正文为空，无法优化`);
    }

    const instruction = normalizeInstruction(payload.instruction);
    assertInstruction(instruction);
    const roundBudget = clampAutoLoopRoundBudget(payload.roundBudget);
    const baseUpdatedAt = chapter.updatedAt.toISOString();
    const traceId = makeOptimizationId('auto-loop');
    const personaBlock = this.buildPersonaBlock(projectId, payload.appearingCharacters, userId);

    callbacks.onStage?.({ stage: 'syncing_context' });
    await this.projectsService.syncContextForChapterPipeline(projectId, userId);

    callbacks.onStart({ traceId, chapterNo, roundBudget, baseUpdatedAt });

    const orchestratorUrl = this.projectsService.getRagOrchestratorUrlForPipeline();

    const result = await runChapterAutoLoop({
      storedContent: chapter.content,
      instruction,
      roundBudget,
      deps: {
        isAborted,
        diagnose: async (input) => {
          callbacks.onStage?.({ stage: 'loop_diagnose', roundIndex: input.roundIndex });
          const prompt = buildAutoLoopPlanUserPrompt({
            instruction,
            chapterNo,
            chapterTitle: chapter.title,
            indexedBody: input.indexedBody,
            roundIndex: input.roundIndex,
            roundBudget: input.roundBudget,
            previousItems: input.previousItems,
            personaBlock,
          });
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
              retrievalChapterTitle: chapter.title,
            },
            callbacks: {},
          });
          if (!response.ok) {
            throw new Error(response.errorMessage || '循环复诊生成失败');
          }
          return response.text;
        },
        rewriteSegment: async (input) => {
          const prompt = buildAutoLoopSegmentUserPrompt({
            instruction,
            paragraphIndex: input.paragraphIndex,
            originalParagraph: input.originalParagraph,
            previousParagraph: input.previousParagraph,
            nextParagraph: input.nextParagraph,
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
              retrievalChapterTitle: chapter.title,
            },
            callbacks: {},
          });
          if (!response.ok) {
            throw new Error(response.errorMessage || '段落改写生成失败');
          }
          return response.text;
        },
      },
      onEvent: (event) => {
        if (event.type === 'round_end') {
          callbacks.onStage?.({ stage: 'loop_round_gate', roundIndex: event.roundIndex });
        }
        callbacks.onEngineEvent(event);
      },
    });

    const now = new Date();
    const existing = getAutoLoopSession(projectId, chapterNo, userId);
    putAutoLoopSession({
      projectId,
      chapterNo,
      userId,
      instruction,
      roundBudget,
      baseUpdatedAt,
      storedContent: chapter.content,
      rounds: result.rounds,
      finalDraft: result.finalDraft,
      stoppedReason: result.stoppedReason,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (result.stoppedReason === 'plan_parse_failed') {
      callbacks.onError('循环复诊未返回可解析的条目，已保留原稿');
      return;
    }

    callbacks.onEnd({
      traceId,
      finalDraftText: result.finalDraft,
      stoppedReason: result.stoppedReason,
      roundCount: result.rounds.length,
      baseUpdatedAt,
    });
  }

  private buildPersonaBlock(
    projectId: string,
    appearingCharacters: string[] | undefined,
    userId?: string
  ): string {
    if (!appearingCharacters?.length) {
      return '';
    }
    return formatAutoLoopPersonaBlock(
      this.projectsService.getPersonas(projectId, userId),
      appearingCharacters
    );
  }
}
