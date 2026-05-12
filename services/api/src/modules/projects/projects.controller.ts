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
  UseGuards,
  Request,
  forwardRef,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
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
  @Get(':id/settings')
  getSettings(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getSettings(id, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body() data: { systemPromptText?: string; activePersonaId?: string | null },
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
