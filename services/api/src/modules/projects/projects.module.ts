import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptTemplatesModule } from '../prompt-templates/prompt-templates.module';
import { TaskPromptsModule } from '../task-prompts/task-prompts.module';
import { ProjectsController } from './projects.controller';
import { ChapterAutoLoopService } from './chapter-auto-loop.service';
import { ChapterRefinementController } from './chapter-refinement.controller';
import { ChapterRefinementService } from './chapter-refinement.service';
import { ChapterRefinementEventBus } from './chapter-refinement-event-bus';
import {
  CHAPTER_REFINEMENT_ENGINE,
  OrchestratedRefinementEngine,
} from './chapter-refinement.engine';
import {
  CHAPTER_REFINEMENT_GATEWAY,
  OrchestratorRefinementGateway,
  type RefinementGenerationGateway,
} from './chapter-refinement.gateway';
import {
  CHAPTER_REFINEMENT_MATERIALS,
  DefaultChapterRefinementMaterialsProvider,
} from './chapter-refinement.materials';
import { AuthService } from '../auth/auth.service';
import { PromptTemplatesService } from '../prompt-templates/prompt-templates.service';
import { TaskPromptsService } from '../task-prompts/task-prompts.service';
import {
  CHAPTER_REFINEMENT_RUN_REPOSITORY,
  createChapterRefinementRunRepository,
} from './chapter-refinement-run.repository';
import { EventCardsService } from './event-cards.service';
import { ProjectsService } from './projects.service';
import { EditorChatController } from './editor-chat.controller';
import { EditorChatService, OrchestratorEditorChatGateway } from './editor-chat.service';
import type { EditorChatProjectsPort } from './editor-chat.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => DocumentsModule),
    forwardRef(() => PromptTemplatesModule),
    forwardRef(() => TaskPromptsModule),
  ],
  controllers: [ProjectsController, ChapterRefinementController, EditorChatController],
  providers: [
    ProjectsService,
    ChapterAutoLoopService,
    EventCardsService,
    ChapterRefinementEventBus,
    {
      provide: CHAPTER_REFINEMENT_RUN_REPOSITORY,
      useFactory: (prisma: PrismaService) => createChapterRefinementRunRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: CHAPTER_REFINEMENT_GATEWAY,
      useFactory: (projects: ProjectsService): RefinementGenerationGateway =>
        new OrchestratorRefinementGateway(() => projects.getRagOrchestratorUrlForPipeline()),
      inject: [ProjectsService],
    },
    {
      provide: CHAPTER_REFINEMENT_ENGINE,
      // AQ-381：单场 inspect→plan→rewrite→review→门禁 编排引擎
      useFactory: (gateway: RefinementGenerationGateway) =>
        new OrchestratedRefinementEngine(gateway),
      inject: [CHAPTER_REFINEMENT_GATEWAY],
    },
    {
      provide: CHAPTER_REFINEMENT_MATERIALS,
      useFactory: (
        projects: ProjectsService,
        taskPrompts: TaskPromptsService,
        promptTemplates: PromptTemplatesService,
        auth: AuthService
      ) =>
        new DefaultChapterRefinementMaterialsProvider(projects, taskPrompts, promptTemplates, auth),
      inject: [ProjectsService, TaskPromptsService, PromptTemplatesService, AuthService],
    },
    ChapterRefinementService,
    OrchestratorEditorChatGateway,
    {
      provide: EditorChatService,
      useFactory: (
        projects: ProjectsService,
        promptTemplates: PromptTemplatesService,
        gateway: OrchestratorEditorChatGateway
      ) => {
        const port: EditorChatProjectsPort = {
          checkAccess: (projectId, userId) => {
            projects.checkAccess(projectId, userId);
          },
          getChapter: (projectId, chapterNo) => {
            const chapter = projects.getChapterRecordForPipeline(projectId, chapterNo);
            if (!chapter) {
              return null;
            }
            return {
              chapterNo: chapter.chapterNo,
              title: chapter.title,
              content: chapter.content,
              updatedAt: chapter.updatedAt,
            };
          },
          getPersonas: (projectId) =>
            projects.getPersonas(projectId).map((p) => ({
              id: p.id,
              name: p.name,
              profile: p.profile,
              state: p.state,
              appearedChapterNos: p.appearedChapterNos,
            })),
          resolveProjectSystemPromptText: (projectId) =>
            promptTemplates.resolveProjectSystemPromptText(projectId),
          getRagOrchestratorUrl: () => projects.getRagOrchestratorUrlForPipeline(),
        };
        return new EditorChatService(port, gateway);
      },
      inject: [ProjectsService, PromptTemplatesService, OrchestratorEditorChatGateway],
    },
  ],
  exports: [ProjectsService, ChapterAutoLoopService, EventCardsService, ChapterRefinementService],
})
export class ProjectsModule {}
