/**
 * AQ-121：将 `data/*.json` 一次性写入 PostgreSQL（需已配置 DATABASE_URL 并完成 migrate deploy）。
 *
 * 用法（在 `services/api` 目录下，或通过 pnpm script，cwd 均为 api 根）：
 *   pnpm migrate:json-to-pg -- --dry-run
 *   pnpm migrate:json-to-pg -- --confirm
 *   pnpm migrate:json-to-pg -- --rollback
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import type { PersistedProjectState } from '../src/modules/projects/persisted-workspace.types';
import {
  syncDocumentsToPostgres,
  type PersistedDocumentsPayload,
} from '../src/persistence/documents-pg-sync';
import {
  syncPromptTemplatesToPostgres,
  type PersistedPromptTemplatesPayload,
} from '../src/persistence/prompt-templates-pg-sync';
import { syncWorkspaceToPostgres } from '../src/persistence/workspace-pg-sync';

config({ path: resolve(process.cwd(), '.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');
const rollback = args.includes('--rollback');

function usageError(msg: string): never {
  console.error(msg);
  console.error('用法: --dry-run | --confirm | --rollback（三选一）');
  process.exit(1);
}

if ([dryRun, confirm, rollback].filter(Boolean).length !== 1) {
  usageError('必须且只能指定 --dry-run、--confirm、--rollback 之一。');
}

if (!process.env.DATABASE_URL?.trim() && !dryRun) {
  usageError('缺少 DATABASE_URL，无法连接 PostgreSQL（--dry-run 除外）。');
}

const workspacePath = resolve(process.cwd(), 'data', 'project-workspaces.json');
const documentsPath = resolve(process.cwd(), 'data', 'documents.json');
const templatesPath = resolve(process.cwd(), 'data', 'prompt-templates.json');

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function ensureUsersForWorkspace(prisma: PrismaClient, workspace: PersistedProjectState) {
  const ids = new Set<string>();
  for (const m of workspace.members) {
    ids.add(m.userId);
  }
  ids.add('1');
  const now = new Date();
  const adminHash = bcrypt.hashSync('password123', 10);
  for (const id of ids) {
    const isAdmin = id === '1';
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email: isAdmin ? 'admin@example.com' : `migrated-${id}@local.invalid`,
        password: isAdmin ? adminHash : bcrypt.hashSync(`migrated-${id}`, 10),
        name: isAdmin ? 'Admin User' : `Migrated user ${id}`,
        createdAt: now,
        updatedAt: now,
      },
      update: {},
    });
  }
}

async function runRollback(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "doc_chunks",
      "document_versions",
      "documents",
      "prompt_template_versions",
      "prompt_templates",
      "relation_events",
      "summary_jobs",
      "index_jobs",
      "chapters",
      "personas",
      "project_settings",
      "project_members",
      "projects",
      "users",
      "drafts",
      "generation_traces"
    RESTART IDENTITY CASCADE;
  `);
  console.log('已执行 TRUNCATE … CASCADE，业务表已清空。');
}

async function main() {
  const workspace = readJson<PersistedProjectState>(workspacePath);
  const documents = readJson<PersistedDocumentsPayload>(documentsPath);
  const templates = readJson<PersistedPromptTemplatesPayload>(templatesPath);

  if (dryRun) {
    if (!workspace) {
      usageError(`未找到或无法解析: ${workspacePath}`);
    }
    console.log(
      `项目: ${workspace.projects.length}，成员: ${workspace.members.length}，` +
        `settings: ${Object.keys(workspace.settings).length}`
    );
    if (documents) {
      console.log(`文档: ${documents.documents?.length ?? 0}`);
    } else {
      console.log('文档: (无文件)');
    }
    if (templates) {
      console.log(`模板: ${templates.templates?.length ?? 0}`);
    } else {
      console.log('模板: (无文件)');
    }
    console.log('--dry-run：未连接数据库、未写入。');
    return;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();

    if (rollback) {
      await runRollback(prisma);
      return;
    }

    if (!workspace) {
      usageError(`未找到或无法解析: ${workspacePath}`);
    }

    console.log(
      `项目: ${workspace.projects.length}，成员: ${workspace.members.length}，` +
        `settings: ${Object.keys(workspace.settings).length}`
    );
    if (documents) {
      console.log(`文档: ${documents.documents?.length ?? 0}`);
    } else {
      console.log('文档: (无文件)');
    }
    if (templates) {
      console.log(`模板: ${templates.templates?.length ?? 0}`);
    } else {
      console.log('模板: (无文件)');
    }

    await ensureUsersForWorkspace(prisma, workspace);
    await syncWorkspaceToPostgres(prisma, workspace);
    console.log('已写入 workspace → PostgreSQL');

    if (documents) {
      await syncDocumentsToPostgres(prisma, documents);
      console.log('已写入 documents → PostgreSQL');
    }

    if (templates) {
      await syncPromptTemplatesToPostgres(prisma, templates);
      console.log('已写入 prompt-templates → PostgreSQL');
    }

    console.log('--confirm：迁移完成。');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
