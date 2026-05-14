import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PromptTemplatesModule } from './modules/prompt-templates/prompt-templates.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ProjectsModule,
    DocumentsModule,
    PromptTemplatesModule,
    ObservabilityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
