import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { usePostgresPersistence } from '../persistence/use-postgres';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    if (!usePostgresPersistence()) {
      return;
    }
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
