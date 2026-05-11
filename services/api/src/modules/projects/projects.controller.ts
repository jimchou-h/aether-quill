import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Get(':id/workspace')
  getWorkspace(@Param('id') id: string) {
    return this.projectsService.getWorkspace(id);
  }

  @Get(':id/export')
  getExportBundle(@Param('id') id: string) {
    return this.projectsService.getExportBundle(id);
  }

  @Get(':id/settings')
  getSettings(@Param('id') id: string) {
    return this.projectsService.getSettings(id);
  }

  @Put(':id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body() data: { systemPromptText?: string; activePersonaId?: string | null }
  ) {
    return this.projectsService.updateSettings(id, data);
  }

  @Get(':id/personas')
  getPersonas(@Param('id') id: string) {
    return this.projectsService.getPersonas(id);
  }

  @Post(':id/personas')
  createPersona(
    @Param('id') id: string,
    @Body()
    data: {
      name: string;
      profile: string;
      tone?: string;
      constraints?: string[];
    }
  ) {
    return this.projectsService.createPersona(id, data);
  }

  @Post(':id/personas/:personaId/publish')
  publishPersona(@Param('id') id: string, @Param('personaId') personaId: string) {
    return this.projectsService.publishPersona(id, personaId);
  }

  @Get(':id/knowledge')
  getKnowledge(@Param('id') id: string) {
    return this.projectsService.getKnowledge(id);
  }

  @Put(':id/knowledge/outline')
  updateOutline(@Param('id') id: string, @Body() data: { outlineSummary: string }) {
    return this.projectsService.updateOutline(id, data);
  }

  @Post(':id/knowledge/chapters')
  upsertChapter(
    @Param('id') id: string,
    @Body() data: { chapterNo: number; title: string; content: string }
  ) {
    return this.projectsService.upsertChapter(id, data);
  }

  @Post(':id/knowledge/reindex')
  createIndexJob(@Param('id') id: string, @Body() data: { mode?: 'full' | 'incremental' } = {}) {
    return this.projectsService.createIndexJob(id, data);
  }

  @Get(':id/knowledge/reindex/:jobId')
  getIndexJob(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.projectsService.getIndexJob(id, jobId);
  }

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
    }
  ) {
    return this.projectsService.writeChapter(id, data);
  }

  @Post()
  create(@Body() data: { name: string; description: string }) {
    return this.projectsService.create(data);
  }
}
