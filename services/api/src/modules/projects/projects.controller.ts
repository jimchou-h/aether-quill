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
  forwardRef,
} from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from './projects.service';
import { ChapterPipelineService } from './chapter-pipeline.service';
import {
  ComplianceCheckOutlineNotConfirmedError,
  ComplianceCheckOutlineReviseInvalidError,
  ComplianceCheckQualityBlockedError,
  ComplianceCheckService,
  ComplianceCheckSessionNotFoundError,
} from './compliance-check.service';
import { serializeComplianceSessionView } from './compliance-check.util';
import {
  ChapterPipelineGateNotConfirmedError,
  ChapterPipelineModuleFailedError,
  ChapterPipelineOutlineReviseInvalidError,
  ChapterPipelineRewriteReviseInvalidError,
  ChapterPipelineCoverageVerifyInvalidError,
  ChapterPipelineRewriteFixItemsInvalidError,
} from './chapter-pipeline.service';
import type {
  ChapterPipelineOutlineReviseMode,
  ChapterPipelineOutlineType,
  ChapterPipelineRewriteFixItemsModule,
  ChapterPipelineSession,
} from './chapter-pipeline.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { ProjectContentSafetyRule } from '@aether-quill/config';
import { createSseStreamContext } from '../../common/sse-stream.util';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly chapterPipelineService: ChapterPipelineService,
    private readonly complianceCheckService: ComplianceCheckService,
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
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('User not authenticated');
    }
    this.documentsService.removeByProjectId(id);
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
      generationTemperature?: number;
      updatePersonaOnSave?: boolean;
      generateRelationEventsOnSave?: boolean;
      chapterOptimizeSegmentCharSize?: number;
      contentSafetyScanEnabled?: boolean;
      contentSafetyCustomRules?: ProjectContentSafetyRule[];
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
  updateOutline(
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
        onStart: ({ traceId, chapterNo: cno, planId, basis, optimizationMode, segmentTotal, strategyLabel, inputChapterChars }) => {
          writeEvent({
            event: 'start',
            traceId,
            chapterNo: cno,
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
        onEnd: ({
          traceId,
          planText,
          planId,
          basis,
          optimizationMode,
          segmentTotal,
          strategyLabel,
          segmentDiagnoses,
        }) => {
          writeEvent({
            event: 'end',
            traceId,
            planText,
            planId,
            basis,
            optimizationMode,
            segmentTotal,
            strategyLabel,
            segmentDiagnoses,
          });
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
      const message = error instanceof Error ? error.message : '生成优化方案失败';
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
      appearingCharacters?: string[];
      selectedEventIds?: string[];
      segmentDiagnoses?: string[];
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
        onStart: ({ traceId, chapterNo: cno, optimizationMode, segmentTotal, strategyLabel }) => {
          writeEvent({
            event: 'start',
            traceId,
            chapterNo: cno,
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
        onEnd: ({ traceId, finalDraftText, contentSafety }) => {
          writeEvent({
            event: 'end',
            traceId,
            ...(finalDraftText ? { finalDraftText } : {}),
            ...(contentSafety ? { contentSafety } : {}),
          });
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
      const message = error instanceof Error ? error.message : '优化正文生成失败';
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
  @Post(':id/knowledge/chapters/:chapterNo/optimize/typo-check')
  checkChapterOptimizationTypos(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body() data: { draftText?: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.checkChapterOptimizationTypos(id, Number(chapterNo), data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/optimize/typo-fix')
  async fixChapterOptimizationTypos(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      draftText?: string;
      issues?: Array<{
        id: string;
        original: string;
        suggestion: string;
        context?: string;
        reason?: string;
      }>;
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
      await this.projectsService.fixChapterOptimizationTyposStream(
        id,
        Number(chapterNo),
        data,
        userId,
        {
          onStart: ({ traceId }) => {
            writeEvent({ event: 'start', traceId });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onStage: ({ stage, message }) => {
            writeEvent({
              event: 'progress',
              taskKey: 'chapter.optimize.typo-fix',
              stage,
              message:
                message ??
                (stage === 'content_safety_rewrite'
                  ? '正在批量重写命中句子…'
                  : '正在执行内容安全扫描…'),
            });
          },
          onContentReplace: (text) => {
            writeEvent({ event: 'content_replace', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: ({ traceId, appliedIssueCount, autoCorrected, finalDraftText, contentSafety }) => {
            writeEvent({
              event: 'end',
              traceId,
              appliedIssueCount,
              autoCorrected,
              ...(finalDraftText ? { finalDraftText } : {}),
              ...(contentSafety ? { contentSafety } : {}),
            });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '错字自动修正失败';
      writeEvent({ event: 'error', data: message });
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/start')
  startChapterPipeline(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Body()
    data: {
      preset?: string;
      mode?: 'pipeline' | 'final-polish';
      configOverrides?: Record<string, unknown>;
      selectedPersonaNames?: string[];
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    const result = this.chapterPipelineService.startSession(
      id,
      Number(chapterNo),
      data,
      userId
    );
    return {
      sessionId: result.sessionId,
      chapterNo: result.chapterNo,
      config: result.config,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId')
  getChapterPipelineSession(
    @Param('sessionId') sessionId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.chapterPipelineService.getSession(sessionId, req.user?.userId);
    return serializePipelineSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/sensory-outline')
  patchChapterPipelineSensoryOutline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      required: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      suggested: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      confirmed: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.chapterPipelineService.patchSensoryOutline(sessionId, data, req.user?.userId);
    return serializePipelineSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/outline')
  patchChapterPipelineOutline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      outlineType: ChapterPipelineOutlineType;
      required: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      suggested: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      confirmed: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.chapterPipelineService.patchOutline(
      sessionId,
      data.outlineType,
      {
        required: data.required,
        suggested: data.suggested,
        confirmed: data.confirmed,
      },
      req.user?.userId
    );
    return serializePipelineSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/outline/revise')
  async reviseChapterPipelineOutline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      outlineType: ChapterPipelineOutlineType;
      mode?: ChapterPipelineOutlineReviseMode;
      currentOutline: {
        required: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
        suggested: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      };
      userFeedback?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      return await this.chapterPipelineService.reviseOutline(sessionId, data, req.user?.userId);
    } catch (error) {
      if (error instanceof ChapterPipelineOutlineReviseInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/outline/coverage-verify')
  async verifyChapterPipelineOutlineCoverage(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      outlineType: ChapterPipelineOutlineType;
      module: ChapterPipelineRewriteFixItemsModule;
      draftTextOverride?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      return await this.chapterPipelineService.verifyOutlineCoverage(
        sessionId,
        data,
        req.user?.userId
      );
    } catch (error) {
      if (error instanceof ChapterPipelineGateNotConfirmedError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      if (error instanceof ChapterPipelineCoverageVerifyInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/outline/coverage')
  patchChapterPipelineOutlineCoverage(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      outlineType: ChapterPipelineOutlineType;
      updates: Array<{
        id: string;
        coverageStatus: 'manual' | 'skipped';
        coverageNote?: string;
      }>;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      const session = this.chapterPipelineService.patchOutlineCoverage(
        sessionId,
        data,
        req.user?.userId
      );
      return serializePipelineSessionView(session);
    } catch (error) {
      if (error instanceof ChapterPipelineCoverageVerifyInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/version')
  patchChapterPipelineVersion(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      versionKey: string;
      text: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.chapterPipelineService.patchPipelineVersion(
      sessionId,
      data,
      req.user?.userId
    );
    return serializePipelineSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/apply')
  applyChapterPipeline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      useVersion?: 'afterRules' | 'final';
      draftTextOverride?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    return this.chapterPipelineService.applyPipeline(sessionId, data, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/run/:module')
  async runChapterPipelineModule(
    @Param('sessionId') sessionId: string,
    @Param('module') module: string,
    @Body() data: { issueId?: string; forceRegenerate?: boolean; userFeedback?: string },
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
      await this.chapterPipelineService.runModuleStream(
        sessionId,
        module as Parameters<ChapterPipelineService['runModuleStream']>[1],
        data,
        userId,
        {
          onStart: ({ traceId, chapterNo, stage }) => {
            writeEvent({ event: 'start', traceId, chapterNo, stage });
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (payload) => {
            writeEvent({ event: 'end', ...payload });
          },
          onGate: (gate, payload) => {
            writeEvent({ event: 'end', gateRequired: true, gate, ...(payload ?? {}) });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      if (error instanceof ChapterPipelineGateNotConfirmedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineModuleFailedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code, module: error.module });
      } else {
        const message = error instanceof Error ? error.message : '分步精修执行失败';
        writeEvent({ event: 'error', data: message });
      }
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/rewrite/revise')
  async reviseChapterPipelineRewrite(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      module: 'sensory-rewrite';
      userFeedback: string;
      draftTextOverride?: string;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.chapterPipelineService.reviseRewriteStream(
        sessionId,
        data,
        req.user?.userId,
        {
          onStart: ({ traceId, chapterNo, stage }) => {
            writeEvent({ event: 'start', traceId, chapterNo, stage });
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (payload) => {
            writeEvent({ event: 'end', ...payload });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      if (error instanceof ChapterPipelineGateNotConfirmedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineRewriteReviseInvalidError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineModuleFailedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code, module: error.module });
      } else {
        const message = error instanceof Error ? error.message : '感官正文按意见修订失败';
        writeEvent({ event: 'error', data: message });
      }
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/pipeline/:sessionId/rewrite/fix-items')
  async fixChapterPipelineRewriteItems(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      module: ChapterPipelineRewriteFixItemsModule;
      itemIds: string[];
      draftTextOverride?: string;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.chapterPipelineService.fixRewriteItemsStream(
        sessionId,
        data,
        req.user?.userId,
        {
          onStart: ({ traceId, chapterNo, stage }) => {
            writeEvent({ event: 'start', traceId, chapterNo, stage });
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (payload) => {
            writeEvent({ event: 'end', ...payload });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      if (error instanceof ChapterPipelineGateNotConfirmedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineRewriteFixItemsInvalidError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineModuleFailedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code, module: error.module });
      } else {
        const message = error instanceof Error ? error.message : '按清单补修失败';
        writeEvent({ event: 'error', data: message });
      }
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/start')
  startComplianceCheck(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    return this.complianceCheckService.startSession(id, Number(chapterNo), req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/compliance-check/session')
  getComplianceCheckSession(
    @Param('id') id: string,
    @Param('chapterNo') chapterNo: string,
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.complianceCheckService.getActiveSession(
      id,
      Number(chapterNo),
      req.user?.userId
    );
    return serializeComplianceSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId')
  getComplianceCheckSessionById(
    @Param('sessionId') sessionId: string,
    @Request() req: AuthenticatedRequest
  ) {
    try {
      const session = this.complianceCheckService.getSession(sessionId, req.user?.userId);
      return serializeComplianceSessionView(session);
    } catch (error) {
      if (error instanceof ComplianceCheckSessionNotFoundError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/outline')
  patchComplianceOutline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      required: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      suggested: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      confirmed: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const session = this.complianceCheckService.patchOutline(sessionId, data, req.user?.userId);
    return serializeComplianceSessionView(session);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/outline/revise')
  async reviseComplianceOutline(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      mode?: 'recheck' | 'revise';
      currentOutline: {
        required: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
        suggested: Array<{ id: string; text: string; priority: 'required' | 'suggested' }>;
      };
      userFeedback?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      return await this.complianceCheckService.reviseOutline(sessionId, data, req.user?.userId);
    } catch (error) {
      if (error instanceof ComplianceCheckOutlineReviseInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/outline/coverage-verify')
  async verifyComplianceOutlineCoverage(
    @Param('sessionId') sessionId: string,
    @Body() data: { draftTextOverride?: string },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      return await this.complianceCheckService.verifyOutlineCoverage(
        sessionId,
        data,
        req.user?.userId
      );
    } catch (error) {
      if (error instanceof ComplianceCheckOutlineNotConfirmedError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      if (error instanceof ChapterPipelineCoverageVerifyInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/outline/coverage')
  patchComplianceOutlineCoverage(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      updates: Array<{
        id: string;
        coverageStatus: 'manual' | 'skipped';
        coverageNote?: string;
      }>;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      const session = this.complianceCheckService.patchOutlineCoverage(
        sessionId,
        data,
        req.user?.userId
      );
      return serializeComplianceSessionView(session);
    } catch (error) {
      if (error instanceof ChapterPipelineCoverageVerifyInvalidError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/rewrite/fix-items')
  async fixComplianceRewriteItems(
    @Param('sessionId') sessionId: string,
    @Body() data: { itemIds: string[]; draftTextOverride?: string },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      await this.complianceCheckService.fixRewriteItemsStream(
        sessionId,
        data,
        req.user?.userId,
        {
          onStart: ({ traceId, chapterNo, stage }) => {
            writeEvent({ event: 'start', traceId, chapterNo, stage });
          },
          onStage: ({ stage, segmentIndex, segmentTotal }) => {
            writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
          },
          onContent: (text) => {
            writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
          },
          onEnd: (payload) => {
            writeEvent({ event: 'end', ...payload });
          },
          onError: (message) => {
            writeEvent({ event: 'error', data: message });
          },
        }
      );
    } catch (error) {
      if (error instanceof ComplianceCheckOutlineNotConfirmedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else if (error instanceof ChapterPipelineRewriteFixItemsInvalidError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else {
        const message = error instanceof Error ? error.message : '合规按项补修失败';
        writeEvent({ event: 'error', data: message });
      }
    } finally {
      res.end();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/apply')
  applyComplianceCheck(
    @Param('sessionId') sessionId: string,
    @Body()
    data: {
      expectedChapterUpdatedAt: string;
      preserveSummary?: boolean;
      draftTextOverride?: string;
      forceApply?: boolean;
    },
    @Request() req: AuthenticatedRequest
  ) {
    try {
      return this.complianceCheckService.applyCompliance(sessionId, data, req.user?.userId);
    } catch (error) {
      if (error instanceof ComplianceCheckQualityBlockedError) {
        throw new BadRequestException({ code: error.code, msg: error.message });
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters/:chapterNo/compliance-check/:sessionId/run/:phase')
  async runComplianceCheckPhase(
    @Param('sessionId') sessionId: string,
    @Param('phase') phase: string,
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;
    if (phase !== 'outline' && phase !== 'rewrite' && phase !== 'pre-scan') {
      throw new BadRequestException('phase 须为 pre-scan、outline 或 rewrite');
    }

    const sse = createSseStreamContext(req, res);
    const writeEvent = (payload: Record<string, unknown>) => {
      if (sse.isAborted()) {
        return false;
      }
      return sse.writeEvent(payload);
    };

    try {
      const callbacks = {
        onStart: ({ traceId, chapterNo, stage }: { traceId: string; chapterNo: number; stage: string }) => {
          writeEvent({ event: 'start', traceId, chapterNo, stage });
        },
        onStage: ({
          stage,
          segmentIndex,
          segmentTotal,
        }: {
          stage: string;
          segmentIndex?: number;
          segmentTotal?: number;
        }) => {
          writeEvent({ event: 'stage', stage, segmentIndex, segmentTotal });
        },
        onContent: (text: string) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: (payload: Record<string, unknown>) => {
          writeEvent({ event: 'end', ...payload });
        },
        onError: (message: string) => {
          writeEvent({ event: 'error', data: message });
        },
      };

      if (phase === 'pre-scan') {
        await this.complianceCheckService.runPreScanStream(sessionId, userId, callbacks);
      } else if (phase === 'outline') {
        await this.complianceCheckService.runOutlineStream(sessionId, userId, callbacks);
      } else {
        await this.complianceCheckService.runRewriteStream(sessionId, userId, callbacks);
      }
    } catch (error) {
      if (error instanceof ComplianceCheckOutlineNotConfirmedError) {
        writeEvent({ event: 'error', data: error.message, code: error.code });
      } else {
        const message = error instanceof Error ? error.message : '合规检验执行失败';
        writeEvent({ event: 'error', data: message });
      }
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
    @Body() body: { actions: Array<'persona' | 'relationEvents'> },
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
  deleteChapter(
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
  @Post(':id/knowledge/reindex')
  createIndexJob(
    @Param('id') id: string,
    @Body() data: { mode?: 'full' | 'incremental' } = {},
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createIndexJob(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/reindex/:jobId')
  getIndexJob(
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.getIndexJob(id, jobId, userId);
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
  @Post(':id/write')
  async writeChapter(
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
      confirmedOutlineText?: string;
      outlineId?: string;
      outlineTraceId?: string;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.writeChapter(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
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

function serializePipelineSessionView(session: ChapterPipelineSession) {
  return {
    sessionId: session.sessionId,
    chapterNo: session.chapterNo,
    config: session.config,
    currentModule: session.currentModule,
    versions: session.versions,
    characterOutline: session.characterOutline,
    characterTraitsOutline: session.characterTraitsOutline,
    sensoryOutline: session.sensoryOutline,
    selectedPersonaNames: session.selectedPersonaNames,
    ruleIssues: session.ruleIssues,
    homogenizationReport: session.homogenizationReport,
    sourceUpdatedAt: session.sourceUpdatedAt,
    finalPolishResult: session.finalPolishResult,
  };
}
