import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  Request,
  forwardRef,
} from '@nestjs/common';
import { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { DocumentsService } from '../documents/documents.service';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
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
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 避免在同步上下文 / 上游首包较慢时长时间无响应体，被中间层或客户端当作空闲连接断开
    res.write(': keep-alive\n\n');

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.projectsService.optimizeChapterPlanStream(id, Number(chapterNo), data, userId, {
        onStart: ({ traceId, chapterNo: cno, planId, basis }) => {
          writeEvent({ event: 'start', traceId, chapterNo: cno, planId, basis });
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: ({ traceId, planText, planId, basis }) => {
          writeEvent({ event: 'end', traceId, planText, planId, basis });
        },
        onError: (message) => {
          writeEvent({ event: 'error', data: message });
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
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: ExpressResponse
  ) {
    const userId = req.user?.userId;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 避免在同步上下文 / 上游首包较慢时长时间无响应体，被中间层或客户端当作空闲连接断开
    res.write(': keep-alive\n\n');

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await this.projectsService.optimizeChapterDraftStream(id, Number(chapterNo), data, userId, {
        onStart: ({ traceId, chapterNo: cno }) => {
          writeEvent({ event: 'start', traceId, chapterNo: cno });
        },
        onContent: (text) => {
          writeEvent({ event: 'content', data: text.replace(/\n/g, '\\n') });
        },
        onEnd: ({ traceId }) => {
          writeEvent({ event: 'end', traceId });
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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': keep-alive\n\n');

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
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
          onEnd: ({ traceId, appliedIssueCount, autoCorrected }) => {
            writeEvent({ event: 'end', traceId, appliedIssueCount, autoCorrected });
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      await this.projectsService.executeChapterAfterSave(
        id,
        Number(chapterNo),
        body,
        userId,
        (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      );
      res.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'after-save failed';
      res.write(`data: ${JSON.stringify({ event: 'error', message })}\n\n`);
      res.end();
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

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': keep-alive\n\n');

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
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
