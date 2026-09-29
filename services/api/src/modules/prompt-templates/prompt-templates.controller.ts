import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  BadRequestException,
} from '@nestjs/common';
import { PromptTemplatesService } from './prompt-templates.service';
import { TemplateCategory } from './prompt-templates.entity';
import { isBlankPromptText, pickSystemTemplate } from './prompt-template-draft.util';

@Controller()
export class PromptTemplatesController {
  constructor(private readonly service: PromptTemplatesService) {}

  @Get('api/projects/:projectId/prompt-templates')
  async findAll(@Param('projectId') projectId: string) {
    await this.service.whenReady;
    return this.service.findByProject(projectId);
  }

  @Post('api/projects/:projectId/prompt-templates')
  async create(
    @Param('projectId') projectId: string,
    @Body() data: { name: string; category: TemplateCategory; content: string }
  ) {
    await this.service.whenReady;
    return this.service.create(projectId, data);
  }

  @Post('api/projects/:projectId/prompt-templates/init')
  async initDefaults(@Param('projectId') projectId: string) {
    await this.service.whenReady;
    return this.service.initDefaults(projectId);
  }

  @Get('api/projects/:projectId/prompt-templates/:templateId')
  async findOne(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    await this.service.whenReady;
    return this.service.findById(projectId, templateId);
  }

  @Put('api/projects/:projectId/prompt-templates/:templateId')
  async update(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() data: { name?: string; content?: string }
  ) {
    await this.service.whenReady;
    return this.service.update(projectId, templateId, data);
  }

  @Delete('api/projects/:projectId/prompt-templates/:templateId')
  async remove(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    await this.service.whenReady;
    this.service.remove(projectId, templateId);
    return { message: '模板已删除' };
  }

  @Post('api/projects/:projectId/prompt-templates/:templateId/publish')
  async publish(@Param('projectId') projectId: string, @Param('templateId') templateId: string) {
    await this.service.whenReady;
    return this.service.publish(projectId, templateId);
  }

  @Post('api/projects/:projectId/prompt-templates/:templateId/rollback')
  async rollback(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() data: { targetVersion?: number }
  ) {
    await this.service.whenReady;
    return this.service.rollback(projectId, templateId, data?.targetVersion);
  }

  @Get('api/projects/:projectId/prompt-templates/:templateId/versions')
  async getVersions(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string
  ) {
    await this.service.whenReady;
    return this.service.getVersions(projectId, templateId);
  }

  @Get('api/projects/:projectId/prompt-config')
  async getPromptConfig(@Param('projectId') projectId: string) {
    await this.service.whenReady;
    if (this.service.findByProject(projectId).length === 0 && this.service.canSeedDefaults) {
      this.service.initDefaults(projectId);
    }

    const templates = this.service.findByProject(projectId);
    const systemTemplate = pickSystemTemplate(templates);

    return {
      systemPromptText:
        systemTemplate?.content?.trim() || this.service.resolveProjectSystemPromptText(projectId),
      activePersonaId: null,
      templates,
    };
  }

  @Put('api/projects/:projectId/prompt-config')
  async updatePromptConfig(
    @Param('projectId') projectId: string,
    @Body() data: { systemPromptText?: string }
  ) {
    await this.service.whenReady;
    if (data.systemPromptText !== undefined) {
      if (isBlankPromptText(data.systemPromptText)) {
        throw new BadRequestException('systemPromptText 不能为空');
      }
      const templates = this.service.findByProject(projectId);
      let systemTemplate = pickSystemTemplate(templates);

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
        isPublished: systemTemplate.isPublished,
      };
    }

    const templates = this.service.findByProject(projectId);
    return { systemPromptText: '', templates };
  }

  @Post('api/projects/:projectId/prompt-config/publish')
  async publishConfig(
    @Param('projectId') projectId: string,
    @Body() data?: { systemPromptText?: string }
  ) {
    await this.service.whenReady;
    const templates = this.service.findByProject(projectId);
    let systemTemplate = pickSystemTemplate(templates);

    if (typeof data?.systemPromptText === 'string') {
      if (isBlankPromptText(data.systemPromptText)) {
        throw new BadRequestException('systemPromptText 不能为空');
      }
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
    }

    if (!systemTemplate) {
      return { message: '没有可发布的系统模板', configId: null, version: 0 };
    }
    return this.service.publish(projectId, systemTemplate.id);
  }

  @Post('api/projects/:projectId/prompt-config/rollback')
  async rollbackConfig(
    @Param('projectId') projectId: string,
    @Body() data: { version?: number; targetVersion?: number }
  ) {
    await this.service.whenReady;
    const templates = this.service.findByProject(projectId);
    const systemTemplate = pickSystemTemplate(templates);
    if (!systemTemplate) {
      return { message: '没有可回滚的系统模板' };
    }
    return this.service.rollback(
      projectId,
      systemTemplate.id,
      data?.version ?? data?.targetVersion
    );
  }
}
