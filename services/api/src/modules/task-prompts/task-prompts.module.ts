import { forwardRef, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TaskPromptsController } from './task-prompts.controller';
import { TaskPromptsService } from './task-prompts.service';

@Module({
  imports: [forwardRef(() => ProjectsModule)],
  controllers: [TaskPromptsController],
  providers: [TaskPromptsService],
  exports: [TaskPromptsService],
})
export class TaskPromptsModule {}
