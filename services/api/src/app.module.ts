import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PromptTemplatesModule } from './modules/prompt-templates/prompt-templates.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AuthModule, ProjectsModule, DocumentsModule, PromptTemplatesModule],
  controllers: [HealthController],
})
export class AppModule {}
