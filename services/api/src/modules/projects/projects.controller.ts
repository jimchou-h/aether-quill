import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest extends ExpressRequest {
  user?: { userId: string; email: string; name: string };
}

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

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
      tone?: string;
      constraints?: string[];
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.createPersona(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/personas/:personaId/publish')
  publishPersona(@Param('id') id: string, @Param('personaId') personaId: string, @Request() req: AuthenticatedRequest) {
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
  updateOutline(@Param('id') id: string, @Body() data: { outlineSummary: string }, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.updateOutline(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/chapters')
  upsertChapter(
    @Param('id') id: string,
    @Body() data: { chapterNo: number; title: string; content: string },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.upsertChapter(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/knowledge/reindex')
  createIndexJob(@Param('id') id: string, @Body() data: { mode?: 'full' | 'incremental' } = {}, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.createIndexJob(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/knowledge/reindex/:jobId')
  getIndexJob(@Param('id') id: string, @Param('jobId') jobId: string, @Request() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    return this.projectsService.getIndexJob(id, jobId, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/write')
  writeChapter(
    @Param('id') id: string,
    @Body()
    data: {
      chapterNo: number;
      goal: string;
      pov: string;
      mustInclude?: string[];
      avoid?: string[];
      targetWords?: number;
    },
    @Request() req: AuthenticatedRequest
  ) {
    const userId = req.user?.userId;
    return this.projectsService.writeChapter(id, data, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() data: { name: string; description: string }, @Request() req: AuthenticatedRequest) {
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
  removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @Request() req: AuthenticatedRequest) {
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      throw new Error('User not authenticated');
    }
    return this.projectsService.removeMember(id, memberId, currentUserId);
  }
}