import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PromptTemplatesModule } from '../prompt-templates/prompt-templates.module';
import { TaskPromptsModule } from '../task-prompts/task-prompts.module';
import { ProjectsController } from './projects.controller';
import { ChapterAutoLoopService } from './chapter-auto-loop.service';
import { EventCardsService } from './event-cards.service';
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
  providers: [ProjectsService, ChapterAutoLoopService, EventCardsService],
  exports: [ProjectsService, ChapterAutoLoopService, EventCardsService],
})
export class ProjectsModule {}
