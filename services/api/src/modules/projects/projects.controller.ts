import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  Request,
  BadRequestException,
  HttpException,
  forwardRef,
} from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from './projects.service';
import { ChapterAutoLoopService } from './chapter-auto-loop.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { ProjectContentSafetyRule } from '@aether-quill/config';
import { createSseStreamContext } from '../../common/sse-stream.util';
import {
  assertWorkbenchDraftRequest,
  assertWorkbenchFixSpanRequest,
  assertWorkbenchReviewRequest,
} from './chapter-optimize-workbench.util';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

/** 只有会真正耗时的两个阶段进活动条，同步上下文与整章校验一闪而过，报了反而抖。 */
function resolveAutoLoopProgressMessage(
  stage: string,
  roundIndex?: number,
  windowIndex?: number,
  windowTotal?: number
): string | null {
  const windowLabel =
    (windowTotal ?? 0) > 1 && (windowIndex ?? 0) > 0 ? `第 ${windowIndex}/${windowTotal} 窗` : '';
  const roundLabel = roundIndex ? `第 ${roundIndex} 轮` : '';
  const head = [windowLabel, roundLabel].filter(Boolean).join('');
  if (stage === 'loop_diagnose') {
    return head ? `正在复诊${head}…` : '正在复诊…';
  }
  if (stage === 'loop_segment_rewrite') {
    return windowLabel ? `正在逐段改写${windowLabel}…` : '正在逐段改写…';
  }
  return null;
}

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly chapterAutoLoopService: ChapterAutoLoopService,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.findAll(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.findOne(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    await this.documentsService.removeByProjectId(id);
    return this.projectsService.remove(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/workspace')
  getWorkspace(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getWorkspace(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/export')
  getExportBundle(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getExportBundle(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/stats')
  getProjectStats(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getProjectStats(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/write-context-readiness')
  getWriteContextReadiness(
    @Param('id') id: string,
    @Query('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.getWriteContextReadiness(id, Number(chapterNo), userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/settings')
  getSettings(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getSettings(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body()
    data: {
      systemPromptText?: string;
      activePersonaId?: string | null;
      chapterSummaryPromptCount?: number;
      chapterSummaryMemoryCount?: number;
      priorChapterTailChars?: number;
      contextExcerptMaxChars?: number;
      outlineMaxChars?: number;
      personaProfileMaxChars?: number;
      relationMemoMaxChars?: number;
      generationTemperature?: number;
      updatePersonaOnSave?: boolean;
      generateRelationEventsOnSave?: boolean;
      parseStructuredInfoOnSave?: boolean;
      chapterOptimizeSegmentCharSize?: number;
      contentSafetyScanEnabled?: boolean;
      contentSafetyCustomRules?: ProjectContentSafetyRule[];
      generationWritingModel?: string | null;
      generationUtilityModel?: string | null;
      writingGenerationTemperature?: number | null;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.updateSettings(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/personas')
  getPersonas(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getPersonas(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/personas')
  createPersona(
    @Param('id') id: string,
    @Body()
    data: {
      name: string;
      profile: string;
      state?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createPersona(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/personas/:personaId')
  updatePersona(
    @Param('id') id: string,
    @Param('personaId') personaId: string,
    @Body()
    data: {
      name?: string;
      profile?: string;
      state?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.updatePersona(id, personaId, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/personas/:personaId')
  deletePersona(
    @Param('id') id: string,
    @Param('personaId') personaId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.deletePersona(id, personaId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/personas/:personaId/publish')
  publishPersona(
    @Param('id') id: string,
    @Param('personaId') personaId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.publishPersona(id, personaId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge')
  getKnowledge(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getKnowledge(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/knowledge/outline')
  async updateOutline(
    @Param('id') id: string,
    @Body() data: { outlineSummary: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.updateOutline(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/summarize')
  createBatchChapterSummaryJob(
    @Param('id') id: string,
    @Body() data: { chapterNos?: number[] } = {},
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createBatchChapterSummaryJob(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/rebuild-summary-memory')
  rebuildChapterSummaryMemory(
    @Param('id') id: string,
    @Body() data: { chapterNos?: number[]; source?: 'existing' | 'content_fallback' } = {},
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.rebuildChapterSummaryMemory(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/summarize')
  createSingleChapterSummaryJob(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createSingleChapterSummaryJob(id, Number(chapterNo), userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/summarize/:jobId')
  getSummaryJob(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.getSummaryJob(id, jobId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/structured-info/parse')
  parseChapterStructuredInfo(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      mode: 'workbench' | 'chapter';
      goal?: string;
      pov?: string;
      mustInclude?: string[];
      avoid?: string[];
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.parseChapterStructuredInfo(id, Number(chapterNo), data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/relation-events/generate')
  generateChapterRelationEvents(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.generateChapterRelationEvents(id, Number(chapterNo), userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/plan')
  async optimizeChapterPlan(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
      existingSegmentDiagnoses?: string[];
      resumeFromSegmentIndex?: number;
      currentPlanText?: string;
      revisionFeedback?: string;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.optimizeChapterPlanStream(id, Number(chapterNo), data, userId, {
        onStart: ({
          traceId,
          chapterNo: currentChapterNo,
          planId,
          basis,
          optimizationMode,
          segmentTotal,
          strategyLabel,
          inputChapterChars,
        }) => {
          writeEvent({
            event: 'start',
            traceId,
            chapterNo: currentChapterNo,
            planId,
            basis,
            optimizationMode,
            segmentTotal,
            strategyLabel,
            inputChapterChars,
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal, retryCount }) => {
          writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal, retryCount });
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: (event) => {
          writeEvent({ event: 'end', ...event });
        },
        onError: (message, recovery) => {
          writeEvent({
            event: 'error',
            data: message,
            failedSegmentIndex: recovery?.failedSegmentIndex,
            segmentTotal: recovery?.segmentTotal,
            segmentDiagnoses: recovery?.segmentDiagnoses,
            retryable: recovery?.retryable,
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成文笔优化方案失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/draft')
  async optimizeChapterDraft(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      planText?: string;
      planId?: string;
      rewriteMode?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
      segmentDiagnoses?: string[];
      sourceText?: string;
      reviewGaps?: string;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.optimizeChapterDraftStream(id, Number(chapterNo), data, userId, {
        onStart: ({
          traceId,
          chapterNo: currentChapterNo,
          optimizationMode,
          segmentTotal,
          strategyLabel,
        }) => {
          writeEvent({
            event: 'start',
            traceId,
            chapterNo: currentChapterNo,
            optimizationMode,
            segmentTotal,
            strategyLabel,
          });
        },
        onStage: ({ stage, segmentIndex, segmentTotal, message }) => {
          writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          if (stage === 'content_safety_scan' || stage === 'content_safety_rewrite') {
            writeEvent({
              event: 'progress',
              taskKey: 'chapter.optimize.draft',
              stage,
              message:
                message ??
                (stage === 'content_safety_rewrite'
                  ? '正在批量重写命中句子…'
                  : '正在执行内容安全扫描…'),
            });
          }
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onContentReplace: (text) => {
          writeEvent({ event: 'content_replace', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: (event) => {
          writeEvent({ event: 'end', ...event });
        },
        onError: (message) => {
          writeEvent({ event: 'error', data: message });
        },
        onSegmentStart: ({ segmentIndex, totalSegments }) => {
          writeEvent({
            event: 'segment_start',
            data: JSON.stringify({ segmentIndex, totalSegments }),
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '文笔优化正文生成失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/workbench/draft')
  async optimizeChapterWorkbenchDraft(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      profile?: string;
      startOffset?: number;
      endOffset?: number;
      baseUpdatedAt?: string;
      sourceText?: string;
      appearingCharacters?: string[];
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    try {
      assertWorkbenchDraftRequest(data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '请求无效');
    }

    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.optimizeChapterWorkbenchDraftStream(
        id,
        Number(chapterNo),
        data,
        userId,
        {
          onStart: ({
            traceId,
            chapterNo: currentChapterNo,
            optimizationMode,
            segmentTotal,
            strategyLabel,
          }) => {
            writeEvent({
              event: 'start',
              traceId,
              chapterNo: currentChapterNo,
              optimizationMode,
              segmentTotal,
              strategyLabel,
            });
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (event) => {
            writeEvent({ event: 'end', ...event });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '按场成稿生成失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/workbench/review')
  async optimizeChapterWorkbenchReview(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      profile?: string;
      rangeText?: string;
      appearingCharacters?: string[];
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      assertWorkbenchReviewRequest(data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '请求无效');
    }
    return this.projectsService.optimizeChapterWorkbenchReview(
      id,
      Number(chapterNo),
      data,
      req.user?.userId
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/workbench/fix-span')
  async optimizeChapterWorkbenchFixSpan(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      spanText?: string;
      instruction?: string;
      profile?: string;
      beforeContext?: string;
      afterContext?: string;
      appearingCharacters?: string[];
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    try {
      assertWorkbenchFixSpanRequest(data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '请求无效');
    }

    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.optimizeChapterWorkbenchFixSpanStream(
        id,
        Number(chapterNo),
        data,
        userId,
        {
          onStart: ({ traceId, chapterNo: currentChapterNo }) => {
            writeEvent({ event: 'start', traceId, chapterNo: currentChapterNo });
          },
          onStage: ({ stage }) => {
            writeEvent({ event: 'stage', stage });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (event) => {
            writeEvent({ event: 'end', ...event });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '点句修复失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/review')
  async optimizeChapterReview(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      planText?: string;
      draftText?: string;
      planId?: string;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.optimizeChapterReviewStream(id, Number(chapterNo), data, userId, {
        onStart: ({ traceId, chapterNo: currentChapterNo }) => {
          writeEvent({ event: 'start', traceId, chapterNo: currentChapterNo });
        },
        onStage: ({ stage }) => {
          writeEvent({ event: 'stage', stage });
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: (event) => {
          writeEvent({ event: 'end', ...event });
        },
        onError: (message) => {
          writeEvent({ event: 'error', data: message });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '冻结验收失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/apply')
  applyChapterOptimization(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      draftText?: string;
      expectedChapterUpdatedAt?: string;
      planId?: string;
      preserveSummary?: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.applyChapterOptimization(id, Number(chapterNo), data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/optimize/auto-loop/session')
  getChapterAutoLoopSession(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.chapterAutoLoopService.getSession(id, Number(chapterNo), userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/optimize/auto-loop/prompt-lab/calls/:callId')
  getAutoLoopPromptLabCall(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Param('callId') callId: string,
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterAutoLoopService.getPromptLabCall(
      id,
      Number(chapterNo),
      callId,
      req.user?.userId
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/auto-loop/prompt-lab/replay')
  replayAutoLoopPromptLab(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body() body: { callId?: string; taskPromptText?: string; projectSystemPromptText?: string },
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterAutoLoopService.replayPromptLab(
      id,
      Number(chapterNo),
      body.callId ?? '',
      body.taskPromptText ?? '',
      req.user?.userId,
      body.projectSystemPromptText
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/auto-loop/prompt-lab/advise')
  adviseAutoLoopPromptLab(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    body: {
      callId?: string;
      taskPromptText?: string;
      projectSystemText?: string;
      message?: string;
      latestReplayOutput?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterAutoLoopService.advisePromptLab(
      id,
      Number(chapterNo),
      {
        callId: body.callId ?? '',
        taskPromptText: body.taskPromptText ?? '',
        projectSystemText: body.projectSystemText,
        message: body.message ?? '',
        latestReplayOutput: body.latestReplayOutput,
        history: body.history,
      },
      req.user?.userId
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/auto-loop')
  async runChapterAutoLoop(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      instruction?: string;
      roundBudget?: number;
      appearingCharacters?: string[];
      resume?: boolean;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.chapterAutoLoopService.runStream(
        id,
        Number(chapterNo),
        data,
        userId,
        {
          onStart: (event) => {
            writeEvent({ event: 'start', ...event });
          },
          onStage: ({ stage, roundIndex, windowIndex, windowTotal }) => {
            writeEvent({ event: 'stage', stage, roundIndex, windowIndex, windowTotal });
            const progressMessage = resolveAutoLoopProgressMessage(
              stage,
              roundIndex,
              windowIndex,
              windowTotal
            );
            if (progressMessage) {
              writeEvent({
                event: 'progress',
                taskKey: 'chapter.optimize.auto-loop',
                stage,
                message: progressMessage,
              });
            }
          },
          onEngineEvent: (event) => {
            switch (event.type) {
              case 'window_start':
                writeEvent({
                  event: 'loop_window_start',
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
              case 'round_start':
                writeEvent({
                  event: 'loop_round_start',
                  roundIndex: event.roundIndex,
                  roundBudget: event.roundBudget,
                  paragraphCount: event.paragraphCount,
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
              case 'plan_items':
                writeEvent({
                  event: 'loop_plan_items',
                  roundIndex: event.roundIndex,
                  items: event.items,
                  targetCount: event.targetCount,
                  unlocatableCount: event.unlocatableCount,
                  deferredCount: event.deferredCount,
                  discardedCount: event.discardedCount,
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
              case 'segment_start':
                writeEvent({
                  event: 'stage',
                  stage: 'loop_segment_rewrite',
                  roundIndex: event.roundIndex,
                  paragraphIndex: event.paragraphIndex,
                  segmentIndex: event.segmentIndex,
                  segmentTotal: event.segmentTotal,
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
              case 'item_status':
                writeEvent({
                  event: 'loop_item_status',
                  roundIndex: event.roundIndex,
                  item: event.item,
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
              case 'round_end':
                writeEvent({
                  event: 'loop_round_end',
                  roundIndex: event.roundIndex,
                  round: event.round,
                  windowIndex: event.windowIndex,
                  windowTotal: event.windowTotal,
                });
                break;
            }
          },
          onPromptLabCall: (call) => {
            writeEvent({ event: 'loop_prompt_lab_call', call });
          },
          onEnd: (event) => {
            writeEvent({ event: 'end', ...event });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        },
        () => sse.isAborted(),
        sse.abortSignal
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '章节自动优化失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/export')
  exportChaptersTxt(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    if (format && format !== 'txt') {
      res.status(400).json({ code: 1316, msg: '仅支持 format=txt 导出' });
      return;
    }

    const { filename, body } = this.projectsService.exportProjectChaptersTxt(id, userId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/relation-events')
  getRelationEvents(
    @Param('id') id: string,
    @Query('counterparty') counterparty: string | undefined,
    @Query('chapterNo') chapterNo: string | undefined,
    @Query('keyword') keyword: string | undefined,
    @Query('appearingCharacters') appearingCharacters: string | undefined,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    const parsedChapterNo = Number(chapterNo);
    return this.projectsService.getRelationEvents(
      id,
      {
        counterparty,
        chapterNo:
          Number.isFinite(parsedChapterNo) && parsedChapterNo > 0 ? parsedChapterNo : undefined,
        keyword,
        appearingCharacters: appearingCharacters
          ? appearingCharacters
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined,
      },
      userId
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/relation-events')
  createRelationEvent(
    @Param('id') id: string,
    @Body()
    data: {
      protagonist?: string;
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo?: number | null;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createRelationEvent(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/relation-events/:eventId')
  updateRelationEvent(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body()
    data: {
      protagonist?: string;
      counterparty: string;
      actors?: string[];
      summary: string;
      evidenceSnippet?: string;
      chapterNo?: number | null;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.updateRelationEvent(id, eventId, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/relation-events/:eventId')
  deleteRelationEvent(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.deleteRelationEvent(id, eventId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/writing-style-samples')
  listWritingStyleSamples(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.projectsService.listWritingStyleSamples(id, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/writing-style-samples')
  createWritingStyleSample(
    @Param('id') id: string,
    @Body()
    data: {
      text: string;
      sceneType: string;
      sourceChapterNo?: number | null;
      label?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    return this.projectsService.createWritingStyleSample(id, data, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/writing-style-samples/:sampleId')
  updateWritingStyleSample(
    @Param('id') id: string,
    @Param('sampleId') sampleId: string,
    @Body()
    data: {
      text?: string;
      sceneType?: string;
      sourceChapterNo?: number | null;
      label?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    return this.projectsService.updateWritingStyleSample(id, sampleId, data, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/writing-style-samples/:sampleId')
  deleteWritingStyleSample(
    @Param('id') id: string,
    @Param('sampleId') sampleId: string,
    @Request() req: AuthenticatedRequest
  ) {
    return this.projectsService.deleteWritingStyleSample(id, sampleId, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters')
  async upsertChapter(
    @Param('id') id: string,
    @Body() data: { chapterNo: number; title: string; content: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.upsertChapter(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/knowledge/chapters/:chapterNo/after-save')
  async chapterAfterSave(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body() body: { actions: Array<'persona' | 'relationEvents' | 'structuredInfo'> },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    const sse = createSseStreamContext(req, res);

    try {
      await this.projectsService.executeChapterAfterSave(
        id,
        Number(chapterNo),
        body,
        userId,
        (event) => {
          if (!sse.isAborted()) {
            sse.writeEvent(event as Record<string, unknown>);
          }
        }
      );
      if (!sse.isAborted()) {
        sse.writeEvent({ event: 'done' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'after-save failed';
      if (!sse.isAborted()) {
        sse.writeEvent({ event: 'error', message });
      }
    } finally {
      sse.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/insert')
  async insertChapter(
    @Param('id') id: string,
    @Body() data: { chapterNo: number; title: string; content: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.insertChapter(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/knowledge/chapters/:chapterNo')
  async deleteChapter(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.deleteChapter(id, Number(chapterNo), userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/renumber')
  renumberChapters(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.renumberChapters(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/import/preview')
  importChapterPreview(
    @Param('id') id: string,
    @Body() data: { content: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.importChapterPreview(id, data.content, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/import/confirm')
  importChapterConfirm(
    @Param('id') id: string,
    @Body()
    data: {
      content: string;
      chapterNos?: number[];
      autoExtractRelationEvents?: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.importChapterConfirm(id, data.content, userId, {
      chapterNos: data.chapterNos,
      autoExtractRelationEvents: data.autoExtractRelationEvents,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/write/outline')
  async writeChapterOutline(
    @Param('id') id: string,
    @Body()
    data: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude?: string[];
      avoid?: string[];
      targetWords?: number;
      appearingCharacters?: string[];
      selectedEventIds?: string[];
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;

    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.projectsService.writeChapterOutlineStream(id, data, userId, {
        onStart: ({ traceId, chapterNo, outlineId, basis }) => {
          writeEvent({ event: 'start', traceId, chapterNo, outlineId, basis });
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: ({ traceId, outlineText, outlineId, basis }) => {
          writeEvent({ event: 'end', traceId, outlineText, outlineId, basis });
        },
        onError: (message) => {
          writeEvent({ event: 'error', data: message });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成章节大纲失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Body() data: { name: string; description: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.create(data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/members')
  getMembers(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getMembers(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() data: { userId: string; role: 'editor' | 'viewer' },
    @Request() req: AuthenticatedRequest
  ) {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }
    return this.projectsService.addMember(id, currentUserId, data.role);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }
    return this.projectsService.removeMember(id, memberId, currentUserId);
  }
}

