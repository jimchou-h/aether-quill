import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('api/projects/:projectId/documents')
  findAll(@Param('projectId') projectId: string) {
    return this.documentsService.findAll(projectId);
  }

  @Post('api/projects/:projectId/documents')
  create(@Param('projectId') projectId: string, @Body() data: { title: string; content: string }) {
    return this.documentsService.create(projectId, data);
  }

  @Get('api/documents/:id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findById(id);
  }

  @Put('api/documents/:id')
  update(@Param('id') id: string, @Body() data: { title?: string; content?: string }) {
    return this.documentsService.update(id, data);
  }

  @Delete('api/documents/:id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }

  @Post('api/documents/:id/reindex')
  reindex(@Param('id') id: string) {
    return this.documentsService.reindex(id);
  }

  @Put('api/documents/:id/index-result')
  commitIndexResult(
    @Param('id') id: string,
    @Body()
    payload: {
      status: 'completed' | 'failed';
      chunks?: Array<{
        id: string;
        content: string;
        embedding?: number[];
        metadata?: Record<string, unknown>;
      }>;
      errorMessage?: string;
    }
  ) {
    return this.documentsService.commitIndexResult(id, payload);
  }

  @Get('api/documents/:id/chunks')
  getChunks(@Param('id') id: string) {
    return this.documentsService.getChunks(id);
  }

  @Get('api/documents/:id/versions')
  getVersions(@Param('id') id: string) {
    return this.documentsService.getVersions(id);
  }
}
