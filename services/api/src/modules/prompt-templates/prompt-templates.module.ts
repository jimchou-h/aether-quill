import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { PromptTemplatesController } from './prompt-templates.controller';
import { PromptTemplatesService } from './prompt-templates.service';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [PromptTemplatesController],
  providers: [PromptTemplatesService],
  exports: [PromptTemplatesService],
})
export class PromptTemplatesModule {}
