import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PromptTemplatesController } from './prompt-templates.controller';
import { PromptTemplatesService } from './prompt-templates.service';

@Module({
  imports: [ProjectsModule],
  controllers: [PromptTemplatesController],
  providers: [PromptTemplatesService],
  exports: [PromptTemplatesService],
})
export class PromptTemplatesModule {}
