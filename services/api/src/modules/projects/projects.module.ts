import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromptTemplatesModule } from '../prompt-templates/prompt-templates.module';
import { TaskPromptsModule } from '../task-prompts/task-prompts.module';
import { ProjectsController } from './projects.controller';
import { ChapterPipelineService } from './chapter-pipeline.service';
import { ComplianceCheckService } from './compliance-check.service';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => DocumentsModule),
    forwardRef(() => PromptTemplatesModule),
    forwardRef(() => TaskPromptsModule),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ChapterPipelineService, ComplianceCheckService],
  exports: [ProjectsService, ChapterPipelineService, ComplianceCheckService],
})
export class ProjectsModule {}
