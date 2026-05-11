import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PromptTemplatesService } from './prompt-templates.service';
import { TemplateCategory } from './prompt-templates.entity';

@Controller()
export class PromptTemplatesController {
  constructor(private readonly service: PromptTemplatesService) {}

  @Get('api/projects/:projectId/prompt-templates')
  findAll(@Param('projectId') projectId: string) {
    return this.service.findByProject(projectId);
  }

  @Post('api/projects/:projectId/prompt-templates')
  create(
    @Param('projectId') projectId: string,
    @Body() data: { name: string; category: TemplateCategory; content: string }
  ) {
    return this.service.create(projectId, data);
  }

  @Post('api/projects/:projectId/prompt-templates/init')
  initDefaults(@Param('projectId') projectId: string) {
    return this.service.initDefaults(projectId);
  }

  @Get('api/projects/:projectId/prompt-templates/:templateId')
  findOne(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    return this.service.findById(projectId, templateId);
  }

  @Put('api/projects/:projectId/prompt-templates/:templateId')
  update(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() data: { name?: string; content?: string }
  ) {
    return this.service.update(projectId, templateId, data);
  }

  @Delete('api/projects/:projectId/prompt-templates/:templateId')
  remove(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    this.service.remove(projectId, templateId);
    return { message: '模板已删除' };
  }

  @Post('api/projects/:projectId/prompt-templates/:templateId/publish')
  publish(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    return this.service.publish(projectId, templateId);
  }

  @Post('api/projects/:projectId/prompt-templates/:templateId/rollback')
  rollback(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() data: { targetVersion?: number }
  ) {
    return this.service.rollback(projectId, templateId, data?.targetVersion);
  }

  @Get('api/projects/:projectId/prompt-templates/:templateId/versions')
  getVersions(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    return this.service.getVersions(projectId, templateId);
  }

  @Get('api/projects/:projectId/prompt-config')
  getPromptConfig(@Param('projectId') projectId: string) {
    const templates = this.service.findByProject(projectId);

    if (templates.length === 0) {
      this.service.initDefaults(projectId);
      return this.service.findByProject(projectId);
    }

    const systemTemplate = templates.find((t) => t.category === 'system');

    return {
      systemPromptText: systemTemplate?.content || '',
      activePersonaId: null,
      templates,
    };
  }

  @Put('api/projects/:projectId/prompt-config')
  updatePromptConfig(
    @Param('projectId') projectId: string,
    @Body() data: { systemPromptText?: string }
  ) {
    if (data.systemPromptText !== undefined) {
      const templates = this.service.findByProject(projectId);
      let systemTemplate = templates.find((t) => t.category === 'system');

      if (systemTemplate) {
        systemTemplate = this.service.update(projectId, systemTemplate.id, {
          content: data.systemPromptText,
        });
      } else {
        systemTemplate = this.service.create(projectId, {
          name: '系统默认模板',
          category: 'system',
          content: data.systemPromptText,
        });
      }

      return {
        systemPromptText: systemTemplate.content,
        templateId: systemTemplate.id,
        version: systemTemplate.version,
      };
    }

    const templates = this.service.findByProject(projectId);
    return { systemPromptText: '', templates };
  }

  @Post('api/projects/:projectId/prompt-config/publish')
  publishConfig(@Param('projectId') projectId: string) {
    const templates = this.service.findByProject(projectId);
    const systemTemplate = templates.find((t) => t.category === 'system');
    if (!systemTemplate) {
      return { message: '没有可发布的系统模板', configId: null, version: 0 };
    }
    return this.service.publish(projectId, systemTemplate.id);
  }

  @Post('api/projects/:projectId/prompt-config/rollback')
  rollbackConfig(@Param('projectId') projectId: string, @Body() data: { targetVersion?: number }) {
    const templates = this.service.findByProject(projectId);
    const systemTemplate = templates.find((t) => t.category === 'system');
    if (!systemTemplate) {
      return { message: '没有可回滚的系统模板' };
    }
    return this.service.rollback(projectId, systemTemplate.id, data?.targetVersion);
  }
}
