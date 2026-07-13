/**
 * 将 `data/project-workspaces.json` 全量同步到 PostgreSQL（不迁移 documents / templates）。
 * 用于 JSON 镜像比 PG 新时的手动恢复。
 */
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { PersistedProjectState } from '../src/modules/projects/persisted-workspace.types';
import { syncWorkspaceToPostgres } from '../src/persistence/workspace-pg-sync';

config({ path: resolve(process.cwd(), '.env') });

const workspacePath = resolve(process.cwd(), 'data', 'project-workspaces.json');

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('缺少 DATABASE_URL');
    process.exit(1);
  }
  if (!existsSync(workspacePath)) {
    console.error(`未找到 ${workspacePath}`);
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(workspacePath, 'utf8')) as PersistedProjectState;
  const prisma = new PrismaClient();
  try {
    await syncWorkspaceToPostgres(prisma, payload);
    console.log(
      `[sync] 已同步 ${payload.projects.length} 个项目到 PostgreSQL（含「系统」等 JSON 独有项）`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
