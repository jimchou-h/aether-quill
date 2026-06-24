import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TaskPromptsService } from './task-prompts.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TaskPromptsController {
  constructor(private readonly service: TaskPromptsService) {}

  @Get('api/projects/:projectId/task-prompts')
  list(@Param('projectId') projectId: string) {
    return this.service.listByProject(projectId);
  }

  @Get('api/projects/:projectId/task-prompts/:templateKey')
  getOne(@Param('projectId') projectId: string, @Param('templateKey') templateKey: string) {
    return this.service.getDetail(projectId, decodeURIComponent(templateKey));
  }

  @Put('api/projects/:projectId/task-prompts/:templateKey')
  saveDraft(
    @Param('projectId') projectId: string,
    @Param('templateKey') templateKey: string,
    @Body() body: { draftText?: string }
  ) {
    return this.service.saveDraft(
      projectId,
      decodeURIComponent(templateKey),
      body?.draftText ?? ''
    );
  }

  @Post('api/projects/:projectId/task-prompts/:templateKey/publish')
  publish(@Param('projectId') projectId: string, @Param('templateKey') templateKey: string) {
    return this.service.publish(projectId, decodeURIComponent(templateKey));
  }

  @Post('api/projects/:projectId/task-prompts/:templateKey/rollback')
  rollback(
    @Param('projectId') projectId: string,
    @Param('templateKey') templateKey: string,
    @Body() body: { targetVersion?: number }
  ) {
    return this.service.rollback(
      projectId,
      decodeURIComponent(templateKey),
      body?.targetVersion
    );
  }
}
