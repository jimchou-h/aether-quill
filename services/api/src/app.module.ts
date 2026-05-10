import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [HealthController]
})
export class AppModule {}
