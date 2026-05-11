import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function loadEnv() {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const candidates = [resolve(process.cwd(), '.env'), resolve(repoRoot, '.env')];

  for (const filePath of candidates) {
    applyEnvFile(filePath);
  }
}
