import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function applyEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findMonorepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const marker = resolve(dir, 'pnpm-workspace.yaml');
    if (existsSync(marker)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

/**
 * 从 monorepo 根目录或 cwd 加载 `.env`（不覆盖已存在的环境变量）。
 */
export function loadEnv() {
  const repoRoot = findMonorepoRoot();
  const candidates = [resolve(process.cwd(), '.env'), resolve(repoRoot, '.env')];

  for (const filePath of candidates) {
    applyEnvFile(filePath);
  }
}
