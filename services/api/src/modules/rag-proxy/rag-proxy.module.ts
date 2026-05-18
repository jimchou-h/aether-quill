import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RagProxyController } from './rag-proxy.controller';

@Module({
  imports: [ProjectsModule],
  controllers: [RagProxyController],
})
export class RagProxyModule {}
